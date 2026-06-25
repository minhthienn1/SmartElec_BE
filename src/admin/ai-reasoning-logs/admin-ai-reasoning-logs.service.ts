import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type AdminAiReasoningQuery = {
  search?: string;
  feedback?: string;
  riskLevel?: string;
  deviceCategory?: string;
  scoreLevel?: string;
  golden?: string;
};

type ReasoningLogRecord = {
  id: number;
  sessionId: number | null;
  userId: number;
  userMsg: string;
  prevState: Prisma.JsonValue | null;
  nextState: Prisma.JsonValue | null;
  riskLevel: string | null;
  aiResponse: string | null;
  aiFeedback: string | null;
  score: number;
  deviceCategory: string | null;
  isGolden: boolean;
  createdAt: Date;
  retrievedChunks?: Array<{
    chunkId: number;
    score: number | null;
    rank: number | null;
    chunk: {
      documentId: number;
      chunkIndex: number;
      content: string;
      document: {
        title: string;
      };
    };
  }>;
  _count?: {
    retrievedChunks: number;
  };
};

@Injectable()
export class AdminAiReasoningLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Xây dựng bộ lọc truy vấn log suy luận AI theo các tham số admin gửi lên. */
  private buildWhere(
    query: AdminAiReasoningQuery,
  ): Prisma.AiReasoningLogWhereInput {
    const where: Prisma.AiReasoningLogWhereInput = {};
    const and: Prisma.AiReasoningLogWhereInput[] = [];

    if (query.feedback === 'LIKE' || query.feedback === 'DISLIKE') {
      and.push({ aiFeedback: query.feedback });
    }

    if (query.feedback === 'NONE') {
      and.push({ aiFeedback: null });
    }

    if (query.riskLevel && query.riskLevel !== 'ALL') {
      and.push({ riskLevel: query.riskLevel });
    }

    if (query.deviceCategory && query.deviceCategory !== 'ALL') {
      and.push({ deviceCategory: query.deviceCategory });
    }

    if (query.scoreLevel === 'LOW_SCORE') {
      and.push({ score: { lte: 4 } });
    }

    if (query.scoreLevel === 'HIGH_SCORE') {
      and.push({ score: { gte: 8 } });
    }

    if (query.golden === 'YES') {
      and.push({ isGolden: true });
    }

    if (query.golden === 'NO') {
      and.push({ isGolden: false });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  /** Gom dữ liệu user để enrich cho danh sách log mà không cần sửa schema Prisma hiện tại. */
  private async buildUserMap(userIds: number[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
      },
    });

    return new Map(users.map((user) => [user.id, user]));
  }

  /** Gom dữ liệu session để hiển thị mã phiên và đối chiếu luồng sửa chữa liên quan. */
  private async buildSessionMap(sessionIds: number[]) {
    const sessions = await this.prisma.chatSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
      },
    });

    return new Map(sessions.map((session) => [session.id, session]));
  }

  /** Kiểm tra từ khóa tìm kiếm trên log AI sau khi đã enrich user và session. */
  private matchesSearch(
    log: {
      id: number;
      sessionId: number | null;
      sessionCode: string | null;
      userId: number;
      userName: string;
      userPhone: string | null;
      userMsg: string;
      aiResponse: string | null;
      deviceCategory: string | null;
    },
    search?: string,
  ) {
    const keyword = search?.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    const haystack = [
      log.id,
      log.sessionId ?? '',
      log.sessionCode ?? '',
      log.userId,
      log.userName,
      log.userPhone ?? '',
      log.userMsg,
      log.aiResponse ?? '',
      log.deviceCategory ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(keyword);
  }

  /** Chuẩn hóa risk level backend sang tập giá trị mà FE admin đang dùng. */
  private normalizeRiskLevel(riskLevel: string | null) {
    if (riskLevel === 'RED') return 'CRITICAL';
    if (riskLevel === 'YELLOW') return 'MEDIUM';
    if (riskLevel === 'GREEN') return 'LOW';
    if (
      riskLevel === 'HIGH' ||
      riskLevel === 'MEDIUM' ||
      riskLevel === 'LOW' ||
      riskLevel === 'CRITICAL'
    ) {
      return riskLevel;
    }

    return null;
  }

  /** Chuẩn hóa một bản ghi log AI từ database sang shape FE admin cần hiển thị. */
  private mapLog(
    log: ReasoningLogRecord,
    userMap: Map<
      number,
      { id: number; fullName: string | null; phoneNumber: string }
    >,
    sessionMap: Map<number, { id: number }>,
  ) {
    const user = userMap.get(log.userId);
    const session =
      log.sessionId != null ? sessionMap.get(log.sessionId) : undefined;

    return {
      id: log.id,
      sessionId: log.sessionId,
      sessionCode: session ? `SE-${session.id}` : null,
      userId: log.userId,
      userName: user?.fullName?.trim() || `Người dùng #${log.userId}`,
      userPhone: user?.phoneNumber ?? null,
      userMsg: log.userMsg,
      prevState:
        log.prevState && typeof log.prevState === 'object'
          ? (log.prevState as Record<string, unknown>)
          : null,
      nextState:
        log.nextState && typeof log.nextState === 'object'
          ? (log.nextState as Record<string, unknown>)
          : null,
      riskLevel: this.normalizeRiskLevel(log.riskLevel),
      aiResponse: log.aiResponse,
      aiFeedback:
        log.aiFeedback === 'LIKE' || log.aiFeedback === 'DISLIKE'
          ? log.aiFeedback
          : null,
      score: log.score,
      deviceCategory: log.deviceCategory,
      isGolden: log.isGolden,
      retrievedChunkCount: log._count?.retrievedChunks ?? 0,
      topRetrievedChunks: (log.retrievedChunks ?? []).map((item) => ({
        chunkId: item.chunkId,
        documentId: item.chunk.documentId,
        documentTitle: item.chunk.document.title,
        chunkIndex: item.chunk.chunkIndex,
        score: item.score,
        rank: item.rank,
        contentPreview:
          item.chunk.content.length > 180
            ? `${item.chunk.content.slice(0, 180)}...`
            : item.chunk.content,
      })),
      createdAt: log.createdAt.toISOString(),
    };
  }

  /** Lấy danh sách log AI cho admin và enrich thêm dữ liệu user, session liên quan. */
  async getLogs(query: AdminAiReasoningQuery) {
    const logs = await this.prisma.aiReasoningLog.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sessionId: true,
        userId: true,
        userMsg: true,
        prevState: true,
        nextState: true,
        riskLevel: true,
        aiResponse: true,
        aiFeedback: true,
        score: true,
        deviceCategory: true,
        isGolden: true,
        createdAt: true,
        retrievedChunks: {
          orderBy: { rank: 'asc' },
          take: 2,
          select: {
            chunkId: true,
            score: true,
            rank: true,
            chunk: {
              select: {
                documentId: true,
                chunkIndex: true,
                content: true,
                document: {
                  select: {
                    title: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            retrievedChunks: true,
          },
        },
      },
    });

    const userIds = Array.from(new Set(logs.map((log) => log.userId)));
    const sessionIds = Array.from(
      new Set(
        logs
          .map((log) => log.sessionId)
          .filter((sessionId): sessionId is number => sessionId != null),
      ),
    );

    const [userMap, sessionMap] = await Promise.all([
      this.buildUserMap(userIds),
      this.buildSessionMap(sessionIds),
    ]);

    return logs
      .map((log) => this.mapLog(log, userMap, sessionMap))
      .filter((log) => this.matchesSearch(log, query.search));
  }

  async getRetrievedChunks(logId: number) {
    const log = await this.prisma.aiReasoningLog.findUnique({
      where: { id: logId },
      select: { id: true },
    });

    if (!log) {
      throw new NotFoundException(`Khong tim thay AI reasoning log voi ID = ${logId}`);
    }

    const chunks = await this.prisma.aiRetrievedChunk.findMany({
      where: { logId },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        chunkId: true,
        score: true,
        rank: true,
        chunk: {
          select: {
            documentId: true,
            chunkIndex: true,
            content: true,
            category: true,
            brand: true,
            modelCode: true,
            accessLevel: true,
            document: {
              select: {
                title: true,
                source: true,
              },
            },
          },
        },
      },
    });

    return {
      logId,
      chunks: chunks.map((item) => ({
        id: item.id,
        chunkId: item.chunkId,
        documentId: item.chunk.documentId,
        documentTitle: item.chunk.document.title,
        chunkIndex: item.chunk.chunkIndex,
        score: item.score,
        rank: item.rank,
        content: item.chunk.content,
        category: item.chunk.category,
        brand: item.chunk.brand,
        modelCode: item.chunk.modelCode,
        source: item.chunk.document.source,
        accessLevel: item.chunk.accessLevel,
      })),
    };
  }
}
