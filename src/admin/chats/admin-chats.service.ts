import { Injectable } from '@nestjs/common';
import { AssignmentAction, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type ChatListQuery = {
  keyword?: string;
  status?: string;
  address?: string;
  technicianName?: string;
  isDangerous?: string;
};

@Injectable()
export class AdminChatsService {
  constructor(private readonly prisma: PrismaService) {}

  private async attachAiConversationFallback<
    T extends {
      id: number;
      user: { id: number; fullName: string | null; avatarUrl: string | null; role: 'USER' | 'TECHNICIAN' | 'ADMIN' };
      messages?: Array<{
        id: number;
        sessionId: number;
        senderId: number | null;
        type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'QUOTE_CARD' | 'SYSTEM_LOG' | 'QUOTE_RESPONSE';
        content: string;
        metadata: Prisma.JsonValue | null;
        isRead: boolean;
        isDeleted: boolean;
        createdAt: Date;
        sender: { id: number; fullName: string | null; avatarUrl: string | null; role: 'USER' | 'TECHNICIAN' | 'ADMIN' } | null;
      }>;
    },
  >(sessions: T[]): Promise<T[]> {
    const missingMessageSessionIds = sessions
      .filter((session) => !Array.isArray(session.messages) || session.messages.length === 0)
      .map((session) => session.id);

    if (missingMessageSessionIds.length === 0) {
      return sessions;
    }

    const logs = await this.prisma.aiReasoningLog.findMany({
      where: {
        sessionId: { in: missingMessageSessionIds },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sessionId: true,
        userMsg: true,
        aiResponse: true,
        createdAt: true,
      },
    });

    const logsBySessionId = new Map<number, typeof logs>();

    for (const log of logs) {
      const items = logsBySessionId.get(log.sessionId ?? -1) ?? [];
      items.push(log);
      logsBySessionId.set(log.sessionId ?? -1, items);
    }

    return sessions.map((session) => {
      if (Array.isArray(session.messages) && session.messages.length > 0) {
        return session;
      }

      const sessionLogs = logsBySessionId.get(session.id) ?? [];
      if (sessionLogs.length === 0) {
        return session;
      }

      return {
        ...session,
        messages: sessionLogs.flatMap((log) => {
          const syntheticMessages: NonNullable<T['messages']> = [];

          if (log.userMsg?.trim()) {
            syntheticMessages.push({
              id: -(log.id * 2),
              sessionId: session.id,
              senderId: session.user.id,
              type: 'TEXT',
              content: log.userMsg,
              metadata: null,
              isRead: true,
              isDeleted: false,
              createdAt: log.createdAt,
              sender: session.user,
            });
          }

          if (log.aiResponse?.trim()) {
            syntheticMessages.push({
              id: -(log.id * 2 + 1),
              sessionId: session.id,
              senderId: null,
              type: 'TEXT',
              content: log.aiResponse,
              metadata: {
                source: 'ai_reasoning_logs',
                logId: log.id,
              },
              isRead: true,
              isDeleted: false,
              createdAt: log.createdAt,
              sender: null,
            });
          }

          return syntheticMessages;
        }),
      };
    });
  }

  private buildWhere(query: ChatListQuery): Prisma.ChatSessionWhereInput {
    const where: Prisma.ChatSessionWhereInput = {};
    const and: Prisma.ChatSessionWhereInput[] = [];
    const keyword = query.keyword?.trim();

    if (keyword) {
      const or: Prisma.ChatSessionWhereInput[] = [
        { symptom: { contains: keyword, mode: 'insensitive' } },
        { aiSummary: { contains: keyword, mode: 'insensitive' } },
        { deviceType: { contains: keyword, mode: 'insensitive' } },
        { contactName: { contains: keyword, mode: 'insensitive' } },
        { contactPhone: { contains: keyword, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phoneNumber: { contains: keyword, mode: 'insensitive' } },
            ],
          },
        },
        {
          technician: {
            OR: [
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phoneNumber: { contains: keyword, mode: 'insensitive' } },
            ],
          },
        },
        {
          messages: {
            some: {
              content: { contains: keyword, mode: 'insensitive' },
            },
          },
        },
      ];

      const maybeId = Number(keyword);
      if (Number.isInteger(maybeId) && maybeId > 0) {
        or.push({ id: maybeId });
      }

      and.push({ OR: or });
    }

    if (query.status && this.isJobStatus(query.status)) {
      and.push({ status: query.status });
    }

    if (query.address?.trim()) {
      and.push({
        address: { contains: query.address.trim(), mode: 'insensitive' },
      });
    }

    if (query.technicianName?.trim()) {
      and.push({
        technician: {
          fullName: {
            contains: query.technicianName.trim(),
            mode: 'insensitive',
          },
        },
      });
    }

    if (query.isDangerous === 'true') {
      and.push({ isDangerous: true });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private isJobStatus(value: string): value is JobStatus {
    return [
      'AI_CONSULTING',
      'BROADCASTING',
      'MATCHED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'DONE',
      'CANCELLED',
    ].includes(value);
  }

  private mapSession(session: {
    id: number;
    userId: number;
    technicianId: number | null;
    deviceId: number | null;
    deviceType: string | null;
    symptom: string | null;
    aiSummary: string | null;
    isDangerous: boolean;
    status: JobStatus;
    version: number;
    contactName: string | null;
    contactPhone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: number;
      fullName: string | null;
      avatarUrl: string | null;
      role: 'USER' | 'TECHNICIAN' | 'ADMIN';
    };
    technician: {
      id: number;
      fullName: string | null;
      avatarUrl: string | null;
      role: 'USER' | 'TECHNICIAN' | 'ADMIN';
    } | null;
    messages?: Array<{
      id: number;
      sessionId: number;
      senderId: number | null;
      type:
        | 'TEXT'
        | 'IMAGE'
        | 'VIDEO'
        | 'QUOTE_CARD'
        | 'SYSTEM_LOG'
        | 'QUOTE_RESPONSE';
      content: string;
      metadata: Prisma.JsonValue | null;
      isRead: boolean;
      isDeleted: boolean;
      createdAt: Date;
      sender: {
        id: number;
        fullName: string | null;
        avatarUrl: string | null;
        role: 'USER' | 'TECHNICIAN' | 'ADMIN';
      } | null;
    }>;
    assignmentHistories?: Array<{
      id: number;
      technicianId: number;
      action: AssignmentAction;
      createdAt: Date;
      technician: { id: number; fullName: string | null } | null;
    }>;
  }) {
    return {
      id: session.id,
      userId: session.userId,
      technicianId: session.technicianId,
      deviceId: session.deviceId,
      deviceType: session.deviceType,
      symptom: session.symptom,
      aiSummary: session.aiSummary,
      isDangerous: session.isDangerous,
      status: session.status,
      version: session.version,
      contactName: session.contactName,
      contactPhone: session.contactPhone,
      address: session.address,
      latitude: session.latitude,
      longitude: session.longitude,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      user: session.user,
      technician: session.technician,
      messages: Array.isArray(session.messages)
        ? session.messages.map((message) => ({
            id: message.id,
            sessionId: message.sessionId,
            senderId: message.senderId,
            sender: message.sender,
            type: message.type,
            content: message.content,
            metadata: message.metadata,
            isRead: message.isRead,
            isDeleted: message.isDeleted,
            createdAt: message.createdAt.toISOString(),
          }))
        : undefined,
      assignmentHistories: Array.isArray(session.assignmentHistories)
        ? session.assignmentHistories.map((item) => ({
            id: item.id,
            technicianId: item.technicianId,
            action: item.action,
            createdAt: item.createdAt.toISOString(),
            technician: item.technician,
          }))
        : undefined,
    };
  }

  /** Tải một phiên chat để chuẩn bị mutation và khóa các trạng thái không còn hợp lệ. */
  private async getSessionForMutation(sessionId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        technicianId: true,
      },
    });

    return session;
  }

  /** Ghi lịch sử gán hoặc gỡ thợ để FE admin đọc lại đúng dữ liệu sau khi thao tác. */
  private createAssignmentHistory(
    tx: Prisma.TransactionClient,
    sessionId: number,
    technicianId: number,
    action: AssignmentAction,
  ) {
    return tx.sessionAssignmentHistory.create({
      data: {
        chatSessionId: sessionId,
        technicianId,
        action,
      },
    });
  }

  async getChats(query: ChatListQuery) {
    const sessions = await this.prisma.chatSession.findMany({
      where: this.buildWhere(query),
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceId: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        isDangerous: true,
        status: true,
        version: true,
        contactName: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        technician: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            sessionId: true,
            senderId: true,
            type: true,
            content: true,
            metadata: true,
            isRead: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
        assignmentHistories: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            technicianId: true,
            action: true,
            createdAt: true,
            technician: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    return sessions.map((session) => this.mapSession(session));
  }

  async getFullConversations(query: ChatListQuery) {
    const sessions = await this.prisma.chatSession.findMany({
      where: this.buildWhere(query),
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceId: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        isDangerous: true,
        status: true,
        version: true,
        contactName: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        technician: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sessionId: true,
            senderId: true,
            type: true,
            content: true,
            metadata: true,
            isRead: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
        assignmentHistories: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            technicianId: true,
            action: true,
            createdAt: true,
            technician: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    const sessionsWithMessages = await this.attachAiConversationFallback(sessions);
    return sessionsWithMessages.map((session) => this.mapSession(session));
  }

  async getChatById(sessionId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceId: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        isDangerous: true,
        status: true,
        version: true,
        contactName: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        technician: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sessionId: true,
            senderId: true,
            type: true,
            content: true,
            metadata: true,
            isRead: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
        assignmentHistories: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            technicianId: true,
            action: true,
            createdAt: true,
            technician: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return null;
    }

    const [sessionWithMessages] = await this.attachAiConversationFallback([session]);
    return this.mapSession(sessionWithMessages);
  }

  /** Gán thợ cho một phiên chat từ giao diện admin và chuyển trạng thái sang MATCHED. */
  async assignTechnician(sessionId: number, technicianId: number) {
    const session = await this.getSessionForMutation(sessionId);

    if (!session) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          technicianId,
          status: 'MATCHED',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      await this.createAssignmentHistory(
        tx,
        sessionId,
        technicianId,
        'ASSIGNED',
      );
    });

    return this.getChatById(sessionId);
  }

  /** Gỡ thợ khỏi phiên chat và trả ca về trạng thái BROADCASTING để điều phối lại. */
  async unassignTechnician(sessionId: number, action: AssignmentAction) {
    const session = await this.getSessionForMutation(sessionId);

    if (!session) {
      return null;
    }

    const technicianId = session.technicianId;

    await this.prisma.$transaction(async (tx) => {
      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          technicianId: null,
          status: 'BROADCASTING',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (technicianId != null) {
        await this.createAssignmentHistory(tx, sessionId, technicianId, action);
      }
    });

    return this.getChatById(sessionId);
  }

  /** Hủy ca từ phía admin và giữ lại lịch sử thao tác để phục vụ điều phối. */
  async cancelChat(sessionId: number) {
    const session = await this.getSessionForMutation(sessionId);

    if (!session) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (session.technicianId != null) {
        await this.createAssignmentHistory(
          tx,
          sessionId,
          session.technicianId,
          'MANUAL_CANCEL',
        );
      }
    });

    return this.getChatById(sessionId);
  }
}
