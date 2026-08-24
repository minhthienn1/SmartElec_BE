import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

//2 loại đánh giá chính: 1 là do khách hàng đánh giá, 2 là do AI đánh giá
type ConversationCandidateType =
  | 'CUSTOMER_5_STAR'
  | 'CUSTOMER_4_STAR'
  | 'AI_8_10'
  | 'AI_6_7';

//Kiểu dữ liệu trả về cho 1 hội thoại đủ tiêu chuẩn để làm RAG
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
  private readonly logger = new Logger(AdminRagKnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly ragIngestionService: RagIngestionService,
  ) { }

  getDocuments() {
    return this.ragService.getAllDocuments();
  }

  //Lấy danh sách RAG hiện có
  getStats() {
    return this.ragService.getDocumentStats();
  }

  //Lấy tài liệu chi tiết
  getDocumentDetail(id: number) {
    return this.ragService.getDocumentDetail(id);
  }

  //Lấy danh sách tài liệu RAG chunk sau khi embedded
  getDocumentChunks(id: number, query: RagDocumentChunksQueryDto) {
    return this.ragService.getDocumentChunks(id, query);
  }

  //Lấy chi tiết chunk RAG
  getChunkDetail(chunkId: number) {
    return this.ragService.getChunkDetail(chunkId);
  }

  //tạo tài liệu
  createDocument(dto: IngestDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  updateDocument(id: number, dto: UpdateRagDocumentDto) {
    return this.ragService.updateDocument(id, dto);
  }

  //Đưa tài liệu sang trạng thái lưu trữ thay vì xóa hẳn.
  archiveDocument(id: number, dto: ArchiveRagDocumentDto) {
    return this.ragService.archiveDocument(id, dto);
  }

  //cập nhật lại index khi có thay đổi về nội dung, metadata, tags, ...
  reindexDocument(id: number) {
    return this.ragService.reindexDocument(id);
  }

  deleteDocument(id: number) {
    return this.ragService.deleteDocument(id);
  }

  //chuyển request sang RAG ingestion 
  importDocumentFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    return this.ragIngestionService.importFile(file, dto, uploadedById);
  }

  //hàm đọc file Rag sau đó gợi ý metadata 
  suggestImportMetadata(file: Express.Multer.File) {
    return this.ragIngestionService.suggestImportMetadata(file);
  }

  //Lấy các cuộc hội thoại có chất lượng tốt để Admin cân nhắc import vào RAG.
  async getConversationCandidates(query: ConversationCandidateQuery) {
    const [reviewCandidates, aiCandidates, importedDocuments] =
      await Promise.all([
        this.getReviewConversationCandidates(),
        this.getAiConversationCandidates(),
        this.prisma.ragDocument.findMany({
          where: {
            source: {
              startsWith: 'CHAT_SESSION:'
            }
          },
          select: { id: true, source: true },
        }),
      ]);

    //biến dl thành map để dễ select 
    const importedMap = new Map(
      importedDocuments
        .filter((document) => document.source)
        .map((document) => [document.source as string, document.id]),
    );

    //filter theo type và search keyword
    const keyword = query.search?.trim().toLowerCase();
    const type = query.type?.trim();

    //sử dụng spread gộp 2 lại với nhau 
    return [...reviewCandidates, ...aiCandidates]
      //Duyệt qua từng phần tử trong mảng và tạo ra một phần tử mới tương ứng
      .map((candidate) => ({
        ...candidate,
        importedDocumentId:
          importedMap.get(`CHAT_SESSION:${candidate.sessionId}`) ?? null,
        alreadyImported:
          //hàm .has() không lấy document ID nó hỏi xem Key này có tồn tại trong Map không ( true / false )
          importedMap.has(
            `CHAT_SESSION:${candidate.sessionId}`
          ),
      }))

      //filter theo kiểu type
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

  //thời điểm admin bấm nút convert Session sang RAG
  async importConversationCandidate(dto: ImportRagConversationDto) {
    this.logger.log(
      `Admin đã chọn import phiên chat sang RAG sessionId=${dto.sessionId}, nguồn=${dto.sourceType}`,
    );

    const existingDocument = await this.prisma.ragDocument.findFirst({
      where: { source: `CHAT_SESSION:${dto.sessionId}` },
      select: { id: true },
    });

    //kiểm tra đã có trong DB chưa , nếu chưa thì block
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

    //biến oject phức tạp thành chuỗi plain text string dễ hiểu
    const content = this.buildConversationRagContent({
      session,
      evaluation,
      note: dto.note,
    });

    //tạo tài liệu mới vào bên trong RAG
    const rawMessages = this.getConversationMessages(session);
    const cleanedMessageCount = rawMessages.filter((message) =>
      this.cleanConversationMessageContent(message.content),
    ).length;
    const normalizedDevice =
      this.normalizeRagField(session.deviceType) !== 'Chưa xác định'
        ? this.normalizeRagField(session.deviceType)
        : this.normalizeRagField(session.aiLogs[0]?.deviceCategory);
    const normalizedBrandModel = this.buildBrandModelLabel(
      session.brand,
      session.modelCode,
    );

    this.logger.log(
      `RAG đã lọc và chuẩn hóa phiên chat sessionId=${session.id}, thiết bị="${normalizedDevice}", hãng/model="${normalizedBrandModel}", tin nhắn gốc=${rawMessages.length}, tin nhắn giữ lại=${cleanedMessageCount}, quyền truy cập=BASIC`,
    );

    const result = await this.ragService.ingestDocument({
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
      accessLevel: 'BASIC',
    });

    const importedDocument = result.document as { id?: number } | undefined;
    this.logger.log(
      `Import phiên chat sang RAG thành công sessionId=${session.id}, documentId=${importedDocument?.id ?? 'không xác định'}, trạng thái=READY, quyền truy cập=BASIC`,
    );

    return result;
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
        sessionId: { not: null }, //log phải là 1 chat session thật
        score: { gte: 6 }, //>=6 điểm mới được coi là chất lượng tốt
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
      where: { //Chỉ cần session đã có bất kỳ Review nào thì nó không còn đi nhánh AI candidate
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

    //map lấy phần tử đầu tiên session có score cao nhất trong logs
    const bestLogBySessionId = new Map<number, (typeof logs)[number]>();

    for (const log of logs) {
      if (!log.sessionId || reviewedSessionIds.has(log.sessionId)) continue;
      if (!bestLogBySessionId.has(log.sessionId)) {
        bestLogBySessionId.set(log.sessionId, log);
      }
    }

    //lấy các sessionId từ map và bỏ vào mảng để query ra các session tương ứng
    const sessionIds = Array.from(bestLogBySessionId.keys());
    if (sessionIds.length === 0) {
      return [];
    }

    //lấy toàn bộ cuộc trò chuyện
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

  //“chuẩn hóa object trả về” để FE nhận cùng một cấu trúc dù candidate đến từ customer review hay AI evaluation
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

  //Đây là helper dùng để tạo reviewCandidates
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

  //Lý do nào khiến conversation này đủ chất lượng để import?
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

  //tổng hợp messge hiện lên cho user biết
  private getConversationMessages(
    session: Awaited<ReturnType<typeof this.getConversationForImport>>,
  ): ConversationMessage[] {
    if (session.messages.length > 0) {
      return session.messages;
    }

    //Mỗi AiReasoningLog có thể sinh 2 message: 1 user, 2 Ai
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

  //tạo một đoạn preview ngắn của toàn bộ cuộc hội thoại
  //dùng để FE hiện bản tóm tắt nhanh
  private buildConversationPreview(messages: ConversationMessage[]) {
    const text = messages
      .map((message) => message.content)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 260 ? `${text.slice(0, 260)}...` : text;
  }

  //hàm đóng gói 1 cuộc trò chuyện thành nội dung RAG hoàn chỉnh
  private cleanConversationMessageContent(content: string) {
    const normalized = this.redactPersonalData(content)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => this.shouldKeepConversationLine(line));

    return this.removeRepeatedConversationLines(normalized)
      .filter((line) => this.shouldKeepConversationLine(line))
      .join('\n')
      .trim();
  }

  private redactPersonalData(text: string) {
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
      .replace(
        /(?<!\d)(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/g,
        '[số điện thoại đã ẩn]',
      )
      .replace(
        /\b\d{1,4}(?:[\/.-]\d{1,4})?(?:\s*,\s*[^,\n]{2,40}){1,4}/g,
        '[địa chỉ đã ẩn]',
      )
      .replace(
        /\b(?:địa chỉ|dia chi|trường|truong|hẻm|hem|đường|duong|phường|phuong|quận|quan|huyện|huyen|thành phố|tp\.?)\b[^.\n]*/gi,
        '[địa chỉ đã ẩn]',
      );
  }

  private shouldKeepConversationLine(line: string) {
    const normalized = line.trim();

    if (!normalized) {
      return false;
    }

    if (/^[A-Z]{1,4}\d{1,4}([-_/][A-Z0-9]{1,6})?$/i.test(normalized)) {
      return true;
    }

    const lower = normalized.toLocaleLowerCase('vi-VN');
    const noiseLines = new Set([
      'alo',
      'hello',
      'hi',
      'ok',
      'oki',
      'okay',
      'vâng',
      'dạ',
      'ừ',
      'ừm',
      'uh',
      'um',
      'cảm ơn',
      'cam on',
      'thanks',
      'thank you',
      'test',
      '[địa chỉ đã ẩn]',
    ]);

    if (noiseLines.has(lower)) {
      return false;
    }

    if (/\[địa chỉ đã ẩn\]/i.test(normalized)) {
      return false;
    }

    if (/^báo giá mới cho\b/i.test(lower)) {
      return false;
    }

    if (
      /\b(?:địa chỉ|dia chi|vị trí|vi tri)\b/i.test(lower) &&
      /\b(?:cần biết|gửi|gửi lại|cho tôi|báo|chính xác|ở đâu)\b/i.test(lower)
    ) {
      return false;
    }

    if (
      /^(?:xin chào|chào|chào bạn|bạn cần|bạn có|đúng vậy|tôi đã đến|tôi bắt đầu đi|chờ tôi|ok\b|okay\b)/i.test(
        lower,
      )
    ) {
      return false;
    }

    if (
      /\b(?:qua|tới|đến|đi tới|tôi qua|tôi ra|trước hẻm|15p|15 phút)\b/i.test(
        lower,
      ) &&
      !this.hasTechnicalConversationSignal(lower)
    ) {
      return false;
    }

    if (
      this.hasOperationalConversationSignal(lower) &&
      !this.hasTechnicalConversationSignal(lower)
    ) {
      return false;
    }

    const meaningfulChars = normalized.replace(/[^\p{L}\p{N}]/gu, '');
    if (meaningfulChars.length < 3) {
      return false;
    }

    return true;
  }

  private hasTechnicalConversationSignal(line: string) {
    return /\b(?:lỗi|loi|triệu chứng|trieu chung|nguyên nhân|nguyen nhan|kiểm tra|kiem tra|vệ sinh|ve sinh|sửa|sua|thay|ngắt nguồn|ngat nguon|cháy|chay|nổ|no|nguy cơ|nguy co|không mát|khong mat|không lạnh|khong lanh|gió yếu|gio yeu|gió nhẹ|gio nhe|rò điện|ro dien|mất nguồn|mat nguon|chập|chap|nóng|nong|lưới lọc|luoi loc|remote|cảm biến|cam bien|block|máy nén|may nen|gas|ống|ong|van|cầu dao|cau dao|aptomat|bo mạch|bo mach)\b/i.test(
      line,
    );
  }

  private hasOperationalConversationSignal(line: string) {
    return /\b(?:địa chỉ|dia chi|định vị|dinh vi|vị trí|vi tri|hẻm|hem|cổng|cong|nhà|nha|trường|truong|đường|duong|phường|phuong|quận|quan|huyện|huyen|tới nơi|toi noi|đến nơi|den noi|đã tới|da toi|đã đến|da den|đang trên đường|dang tren duong|trên đường|tren duong|chờ|đợi|doi|phút|phut|giờ|gio|15p|30p|nhận đơn|nhan don|bắt đầu đi|bat dau di|bắt đầu sửa|bat dau sua|hoàn thành|hoan thanh|hủy đơn|huy don|đổi thợ|doi tho|báo giá|bao gia|thanh toán|thanh toan|hóa đơn|hoa don|chấp nhận báo giá|chap nhan bao gia|đã gửi ảnh|da gui anh|gửi ảnh|gui anh|tải lên hình|tai len hinh|file đính kèm|file dinh kem|image uploaded|ảnh|anh|video)\b/i.test(
      line,
    );
  }

  private removeRepeatedConversationLines(lines: string[]) {
    const result: string[] = [];
    const seenKeys = new Set<string>();

    for (const line of lines) {
      const key = line
        .toLocaleLowerCase('vi-VN')
        .replace(/\s+/g, ' ')
        .replace(/[.,;:!?]+$/g, '')
        .trim();

      if (seenKeys.has(key)) {
        continue;
      }

      result.push(line);
      seenKeys.add(key);
    }

    return result;
  }

  private normalizeRagField(value?: string | null) {
    const normalized = value?.trim();

    if (!normalized || /^unknown$/i.test(normalized)) {
      return 'Chưa xác định';
    }

    return normalized;
  }

  private buildBrandModelLabel(brand?: string | null, modelCode?: string | null) {
    const normalizedBrand = this.normalizeRagField(brand);
    const normalizedModel = this.normalizeRagField(modelCode);

    if (
      normalizedBrand === 'Chưa xác định' &&
      normalizedModel === 'Chưa xác định'
    ) {
      return 'Chưa xác định';
    }

    return `${normalizedBrand} / ${normalizedModel}`;
  }

  private extractTechnicalKeywords(text: string) {
    const keywords = new Set<string>();
    const matches =
      text.match(/\b[A-Z]{1,4}\d{1,4}(?:[-_/][A-Z0-9]{1,6})?\b/gi) ?? [];

    for (const match of matches) {
      keywords.add(match.toUpperCase());
    }

    return Array.from(keywords).slice(0, 12);
  }

  private buildTechnicalSummary(params: {
    session: Awaited<ReturnType<typeof this.getConversationForImport>>;
    evaluation: NonNullable<
      Awaited<ReturnType<typeof this.resolveConversationEvaluation>>
    >;
    note?: string;
    transcript: string;
  }) {
    const { session, evaluation, note, transcript } = params;
    const device =
      this.normalizeRagField(session.deviceType) !== 'Chưa xác định'
        ? this.normalizeRagField(session.deviceType)
        : this.normalizeRagField(session.aiLogs[0]?.deviceCategory);
    const brandModel = this.buildBrandModelLabel(
      session.brand,
      session.modelCode,
    );
    const symptom = this.cleanConversationMessageContent(session.symptom || '');
    const aiSummary = this.cleanConversationMessageContent(
      session.aiSummary || '',
    );
    const evaluationNote = this.cleanConversationMessageContent(
      evaluation.note || '',
    );
    const adminNote = this.cleanConversationMessageContent(note || '');
    const technicalKeywords = this.extractTechnicalKeywords(
      [symptom, aiSummary, evaluationNote, adminNote, transcript]
        .filter(Boolean)
        .join('\n'),
    );

    return [
      'Tóm tắt kỹ thuật:',
      `- Thiết bị: ${device}`,
      `- Hãng/model: ${brandModel}`,
      `- Mã lỗi/từ khóa kỹ thuật: ${technicalKeywords.join(', ') || 'Chưa xác định'}`,
      `- Triệu chứng: ${symptom || 'Chưa xác định'}`,
      `- Kết luận AI: ${aiSummary || evaluationNote || 'Chưa có kết luận'}`,
      adminNote ? `- Ghi chú admin: ${adminNote}` : null,
    ].filter((line): line is string => line !== null);
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
    const cleanedMessages = messages
      .map((message) => {
        const content = this.cleanConversationMessageContent(message.content);
        if (!content) {
          return null;
        }

        const speaker = message.sender
          ? message.sender.role === 'TECHNICIAN'
            ? 'Kỹ thuật viên'
            : 'Khách hàng'
          : 'AI tư vấn';

        return {
          speaker,
          content,
        };
      })
      .filter(
        (message): message is { speaker: string; content: string } =>
          message !== null,
      );
    const transcript = cleanedMessages
      .map((message, index) => `${index + 1}. ${message.speaker}: ${message.content}`)
      .join('\n');
    const technicalSummary = this.buildTechnicalSummary({
      session,
      evaluation,
      note,
      transcript,
    });

    return [
      `Mã phiên: SE-${session.id}`,
      `Loại tài liệu: Cuộc trò chuyện với người dùng`,
      `Nguồn đánh giá: ${evaluation.label}`,
      `AI conclusion: ${evaluation.sourceType === RagConversationImportSource.AI_CONCLUSION
        ? 'Có - cuộc trò chuyện được AI kết luận'
        : 'Không - cuộc trò chuyện được khách hàng đánh giá'
      }`,
      '',
      ...technicalSummary,
      '',
      'Thông tin gốc:',
      `Thiết bị: ${this.normalizeRagField(session.deviceType)}`,
      `Hãng/model: ${this.buildBrandModelLabel(session.brand, session.modelCode)}`,
      `Vấn đề khách mô tả: ${this.cleanConversationMessageContent(session.symptom || '') || 'Chưa có mô tả'}`,
      `Tóm tắt AI: ${this.cleanConversationMessageContent(session.aiSummary || '') || 'Chưa có tóm tắt'}`,
      this.cleanConversationMessageContent(evaluation.note || '')
        ? `Ghi chú đánh giá: ${this.cleanConversationMessageContent(evaluation.note || '')}`
        : null,
      this.cleanConversationMessageContent(note || '')
        ? `Ghi chú admin: ${this.cleanConversationMessageContent(note || '')}`
        : null,
      '',
      'Nội dung hội thoại đã làm sạch:',
      transcript || 'Chưa có nội dung hội thoại.',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
