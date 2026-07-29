import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageType, RagDocumentKind } from '@prisma/client';
import { ArchiveRagDocumentDto } from '../../rag/dto/archive-rag-document.dto';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { UpdateRagDocumentDto } from '../../rag/dto/update-rag-document.dto';
import { ImportRagFileDto } from '../../rag/dto/import-rag-file.dto';
import { RagDocumentChunksQueryDto } from '../../rag/dto/rag-document-chunks-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { RagIngestionService } from '../../rag/rag-ingestion.service';
import { RagService } from '../../rag/rag.service';
import {
  ImportRagConversationDto,
  RagConversationImportSource,
} from './dto/import-rag-conversation.dto';

type ConversationCandidateType =
  | 'CUSTOMER_5_STAR'
  | 'CUSTOMER_4_STAR'
  | 'AI_8_10'
  | 'AI_6_7';

type ConversationCandidateQuery = {
  type?: string;
  search?: string;
};

type ConversationMessage = {
  content: string;
  type: MessageType;
  createdAt: Date;
  sender: {
    id: number;
    fullName: string | null;
    role: string;
  } | null;
};

type ConversationAiLog = {
  userMsg: string;
  aiResponse: string | null;
  score: number;
  deviceCategory: string | null;
  createdAt: Date;
};

@Injectable()
export class AdminRagKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly ragIngestionService: RagIngestionService,
  ) {}

  getDocuments() {
    return this.ragService.getAllDocuments();
  }

  getStats() {
    return this.ragService.getDocumentStats();
  }

  getDocumentDetail(id: number) {
    return this.ragService.getDocumentDetail(id);
  }

  getDocumentChunks(id: number, query: RagDocumentChunksQueryDto) {
    return this.ragService.getDocumentChunks(id, query);
  }

  getChunkDetail(chunkId: number) {
    return this.ragService.getChunkDetail(chunkId);
  }

  createDocument(dto: IngestDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  updateDocument(id: number, dto: UpdateRagDocumentDto) {
    return this.ragService.updateDocument(id, dto);
  }

  archiveDocument(id: number, dto: ArchiveRagDocumentDto) {
    return this.ragService.archiveDocument(id, dto);
  }

  reindexDocument(id: number) {
    return this.ragService.reindexDocument(id);
  }

  deleteDocument(id: number) {
    return this.ragService.deleteDocument(id);
  }

  importDocumentFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    return this.ragIngestionService.importFile(file, dto, uploadedById);
  }

  suggestImportMetadata(file: Express.Multer.File) {
    return this.ragIngestionService.suggestImportMetadata(file);
  }

  async getConversationCandidates(query: ConversationCandidateQuery) {
    const [reviewCandidates, aiCandidates, importedDocuments] =
      await Promise.all([
        this.getReviewConversationCandidates(),
        this.getAiConversationCandidates(),
        this.prisma.ragDocument.findMany({
          where: { source: { startsWith: 'CHAT_SESSION:' } },
          select: { id: true, source: true },
        }),
      ]);

    const importedMap = new Map(
      importedDocuments
        .filter((document) => document.source)
        .map((document) => [document.source as string, document.id]),
    );

    const keyword = query.search?.trim().toLowerCase();
    const type = query.type?.trim();

    return [...reviewCandidates, ...aiCandidates]
      .map((candidate) => ({
        ...candidate,
        importedDocumentId:
          importedMap.get(`CHAT_SESSION:${candidate.sessionId}`) ?? null,
        alreadyImported: importedMap.has(`CHAT_SESSION:${candidate.sessionId}`),
      }))
      .filter((candidate) => !type || type === 'ALL' || candidate.type === type)
      .filter((candidate) => {
        if (!keyword) return true;

        return [
          candidate.sessionId,
          candidate.sessionCode,
          candidate.customerName,
          candidate.customerPhone,
          candidate.deviceType,
          candidate.symptom,
          candidate.aiSummary,
          candidate.preview,
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      });
  }

  async importConversationCandidate(dto: ImportRagConversationDto) {
    const existingDocument = await this.prisma.ragDocument.findFirst({
      where: { source: `CHAT_SESSION:${dto.sessionId}` },
      select: { id: true },
    });

    if (existingDocument) {
      throw new BadRequestException(
        'Cuộc trò chuyện này đã được import vào kho RAG.',
      );
    }

    const session = await this.getConversationForImport(dto.sessionId);
    const evaluation = await this.resolveConversationEvaluation(
      dto.sessionId,
      dto.sourceType,
    );

    if (!evaluation) {
      throw new BadRequestException(
        dto.sourceType === RagConversationImportSource.CUSTOMER_REVIEW
          ? 'Phiên này chưa có đánh giá khách hàng hợp lệ để import.'
          : 'Phiên này chưa có kết luận AI hợp lệ để import.',
      );
    }

    const content = this.buildConversationRagContent({
      session,
      evaluation,
      note: dto.note,
    });

    return this.ragService.ingestDocument({
      title: `Cuộc trò chuyện SE-${session.id} - ${session.deviceType || 'Thiết bị'}`,
      description:
        dto.sourceType === RagConversationImportSource.CUSTOMER_REVIEW
          ? `Tài liệu chat được duyệt từ đánh giá ${evaluation.customerRating}/5 sao của khách hàng.`
          : `Tài liệu chat được duyệt từ kết luận AI ${evaluation.aiScore}/10 điểm.`,
      content,
      category: session.deviceType || session.aiLogs[0]?.deviceCategory || 'CHAT_CONVERSATION',
      source: `CHAT_SESSION:${session.id}`,
      tags: [
        'chat-conversation',
        dto.sourceType === RagConversationImportSource.CUSTOMER_REVIEW
          ? 'customer-reviewed'
          : 'ai-conclusion',
        evaluation.customerRating ? `${evaluation.customerRating}-star` : '',
        evaluation.aiScore ? `ai-score-${evaluation.aiScore}` : '',
      ].filter(Boolean),
      kind: RagDocumentKind.INTERNAL_NOTE,
      accessLevel: 'ADVANCED',
    });
  }

  private async getReviewConversationCandidates() {
    const reviews = await this.prisma.review.findMany({
      where: { rating: { in: [4, 5] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        session: {
          select: this.getConversationSelect(),
        },
      },
    });

    return reviews.map((review) =>
      this.mapConversationCandidate({
        session: { ...review.session, aiLogs: [] },
        type: review.rating === 5 ? 'CUSTOMER_5_STAR' : 'CUSTOMER_4_STAR',
        sourceType: RagConversationImportSource.CUSTOMER_REVIEW,
        customerRating: review.rating,
        aiScore: null,
        aiConclusion: false,
        evidenceLabel: `${review.rating}/5 sao từ khách hàng`,
        evidenceNote: review.comment,
        evaluatedAt: review.createdAt,
      }),
    );
  }

  private async getAiConversationCandidates() {
    const logs = await this.prisma.aiReasoningLog.findMany({
      where: {
        sessionId: { not: null },
        score: { gte: 6 },
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        sessionId: true,
        score: true,
        aiFeedback: true,
        aiResponse: true,
        deviceCategory: true,
        createdAt: true,
      },
    });

    const reviewedSessions = await this.prisma.review.findMany({
      where: {
        sessionId: {
          in: logs
            .map((log) => log.sessionId)
            .filter((sessionId): sessionId is number => sessionId != null),
        },
      },
      select: { sessionId: true },
    });
    const reviewedSessionIds = new Set(
      reviewedSessions.map((review) => review.sessionId),
    );
    const bestLogBySessionId = new Map<number, (typeof logs)[number]>();

    for (const log of logs) {
      if (!log.sessionId || reviewedSessionIds.has(log.sessionId)) continue;
      if (!bestLogBySessionId.has(log.sessionId)) {
        bestLogBySessionId.set(log.sessionId, log);
      }
    }

    const sessionIds = Array.from(bestLogBySessionId.keys());
    if (sessionIds.length === 0) {
      return [];
    }

    const sessions = await this.prisma.chatSession.findMany({
      where: { id: { in: sessionIds } },
      orderBy: { updatedAt: 'desc' },
      select: this.getConversationSelect(),
    });

    return sessions.map((session) => {
      const log = bestLogBySessionId.get(session.id);
      const score = log?.score ?? 0;

      return this.mapConversationCandidate({
        session: {
          ...session,
          aiLogs: log
            ? [
                {
                  userMsg: '',
                  aiResponse: log.aiResponse,
                  score: log.score,
                  deviceCategory: log.deviceCategory,
                  createdAt: log.createdAt,
                },
              ]
            : [],
        },
        type: score >= 8 ? 'AI_8_10' : 'AI_6_7',
        sourceType: RagConversationImportSource.AI_CONCLUSION,
        customerRating: null,
        aiScore: score,
        aiConclusion: true,
        evidenceLabel: `AI tự đánh giá ${score}/10 điểm`,
        evidenceNote: log?.aiResponse ?? null,
        evaluatedAt: log?.createdAt ?? session.updatedAt,
      });
    });
  }

  private getConversationSelect() {
    return {
      id: true,
      deviceType: true,
      brand: true,
      modelCode: true,
      symptom: true,
      aiSummary: true,
      isDangerous: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
        },
      },
      messages: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: {
          content: true,
          type: true,
          createdAt: true,
          sender: {
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
      },
    } as const;
  }

  private mapConversationCandidate(params: {
    session: Awaited<ReturnType<typeof this.getConversationForImport>>;
    type: ConversationCandidateType;
    sourceType: RagConversationImportSource;
    customerRating: number | null;
    aiScore: number | null;
    aiConclusion: boolean;
    evidenceLabel: string;
    evidenceNote: string | null;
    evaluatedAt: Date;
  }) {
    const { session } = params;
    const preview = this.buildConversationPreview(
      this.getConversationMessages(session),
    );

    return {
      sessionId: session.id,
      sessionCode: `SE-${session.id}`,
      type: params.type,
      sourceType: params.sourceType,
      customerName: session.user.fullName?.trim() || `Khách #${session.user.id}`,
      customerPhone: session.user.phoneNumber,
      deviceType: session.deviceType,
      brand: session.brand,
      modelCode: session.modelCode,
      symptom: session.symptom,
      aiSummary: session.aiSummary,
      customerRating: params.customerRating,
      aiScore: params.aiScore,
      aiConclusion: params.aiConclusion,
      evidenceLabel: params.evidenceLabel,
      evidenceNote: params.evidenceNote,
      messageCount: this.getConversationMessages(session).length,
      preview,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      evaluatedAt: params.evaluatedAt.toISOString(),
    };
  }

  private async getConversationForImport(sessionId: number) {
    const [session, aiLogs] = await Promise.all([
      this.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: this.getConversationSelect(),
      }),
      this.prisma.aiReasoningLog.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          userMsg: true,
          aiResponse: true,
          score: true,
          deviceCategory: true,
          createdAt: true,
        },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    }

    return { ...session, aiLogs };
  }

  private async resolveConversationEvaluation(
    sessionId: number,
    sourceType: RagConversationImportSource,
  ) {
    if (sourceType === RagConversationImportSource.CUSTOMER_REVIEW) {
      const review = await this.prisma.review.findUnique({
        where: { sessionId },
        select: { rating: true, comment: true, createdAt: true },
      });

      if (!review || ![4, 5].includes(review.rating)) {
        return null;
      }

      return {
        sourceType,
        customerRating: review.rating,
        aiScore: null,
        label: `${review.rating}/5 sao từ khách hàng`,
        note: review.comment,
        evaluatedAt: review.createdAt,
      };
    }

    const log = await this.prisma.aiReasoningLog.findFirst({
      where: {
        sessionId,
        score: { gte: 6 },
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      select: {
        score: true,
        aiResponse: true,
        createdAt: true,
      },
    });

    if (!log) {
      return null;
    }

    return {
      sourceType,
      customerRating: null,
      aiScore: log.score,
      label: `AI tự đánh giá ${log.score}/10 điểm`,
      note: log.aiResponse,
      evaluatedAt: log.createdAt,
    };
  }

  private getConversationMessages(
    session: Awaited<ReturnType<typeof this.getConversationForImport>>,
  ): ConversationMessage[] {
    if (session.messages.length > 0) {
      return session.messages;
    }

    return session.aiLogs.flatMap((log) => {
      const messages: ConversationMessage[] = [];

      if (log.userMsg?.trim()) {
        messages.push({
          content: log.userMsg,
          type: MessageType.TEXT,
          createdAt: log.createdAt,
          sender: session.user
            ? {
                id: session.user.id,
                fullName: session.user.fullName,
                role: 'USER',
              }
            : null,
        });
      }

      if (log.aiResponse?.trim()) {
        messages.push({
          content: log.aiResponse,
          type: MessageType.TEXT,
          createdAt: log.createdAt,
          sender: null,
        });
      }

      return messages;
    });
  }

  private buildConversationPreview(messages: ConversationMessage[]) {
    const text = messages
      .map((message) => message.content)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 260 ? `${text.slice(0, 260)}...` : text;
  }

  private buildConversationRagContent(params: {
    session: Awaited<ReturnType<typeof this.getConversationForImport>>;
    evaluation: NonNullable<
      Awaited<ReturnType<typeof this.resolveConversationEvaluation>>
    >;
    note?: string;
  }) {
    const { session, evaluation, note } = params;
    const messages = this.getConversationMessages(session);
    const transcript = messages
      .map((message, index) => {
        const speaker = message.sender
          ? message.sender.role === 'TECHNICIAN'
            ? 'Kỹ thuật viên'
            : 'Khách hàng'
          : 'AI tư vấn';

        return `${index + 1}. ${speaker}: ${message.content}`;
      })
      .join('\n');

    return [
      `Mã phiên: SE-${session.id}`,
      `Loại tài liệu: Cuộc trò chuyện với người dùng`,
      `Nguồn đánh giá: ${evaluation.label}`,
      `AI conclusion: ${
        evaluation.sourceType === RagConversationImportSource.AI_CONCLUSION
          ? 'Có - cuộc trò chuyện được AI kết luận'
          : 'Không - cuộc trò chuyện được khách hàng đánh giá'
      }`,
      `Thiết bị: ${session.deviceType || 'Chưa xác định'}`,
      `Hãng/model: ${[session.brand, session.modelCode].filter(Boolean).join(' / ') || 'Chưa xác định'}`,
      `Vấn đề khách mô tả: ${session.symptom || 'Chưa có mô tả'}`,
      `Tóm tắt AI: ${session.aiSummary || 'Chưa có tóm tắt'}`,
      evaluation.note ? `Ghi chú đánh giá: ${evaluation.note}` : null,
      note?.trim() ? `Ghi chú admin: ${note.trim()}` : null,
      '',
      'Nội dung hội thoại:',
      transcript || 'Chưa có nội dung hội thoại.',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
