import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JobStatus, MessageType, SessionType } from '@prisma/client';

import { CreateChatSessionDto } from '../chats/dto/create-chat-session.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ChatsService } from '../chats/chats.service';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class ChatsWebService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatsService: ChatsService,
    private readonly uploadService: UploadService,
  ) {}

  async createChatSession(userId: number, dto: CreateChatSessionDto) {
    return this.chatsService.createChatSession(userId, dto);
  }

  async getSessionByIdForUser(
    sessionId: number,
    userId: number,
    role?: string,
  ) {
    await this.chatsService.assertCanAccessSession(sessionId, userId, role);

    const session = await this.chatsService.getSessionById(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat này.');
    }

    const aiMetadata = await this.getLatestAiSessionMetadata(sessionId);

    return {
      ...session,
      ...aiMetadata,
      bookingTriggered: session.status !== JobStatus.AI_CONSULTING,
    };
  }

  async getLatestAiSessionMetadata(sessionId: number) {
    const latestLog = await this.prisma.aiReasoningLog.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        aiFeedback: true,
        riskLevel: true,
        nextState: true,
      },
    });

    const nextState =
      latestLog?.nextState && typeof latestLog.nextState === 'object'
        ? (latestLog.nextState as Record<string, any>)
        : null;

    return {
      latestAiLogId: latestLog?.id ?? null,
      latestAiFeedback:
        latestLog?.aiFeedback === 'LIKE' || latestLog?.aiFeedback === 'DISLIKE'
          ? latestLog.aiFeedback
          : null,
      aiStateSnapshot: nextState,
      risk:
        typeof nextState?.risk === 'string'
          ? nextState.risk
          : latestLog?.riskLevel ?? null,
      canBook:
        typeof nextState?.canBook === 'boolean' ? nextState.canBook : null,
      chatClosed:
        typeof nextState?.chatClosed === 'boolean'
          ? nextState.chatClosed
          : null,
      symptomLabel:
        typeof nextState?.symptomLabel === 'string'
          ? nextState.symptomLabel
          : null,
      symptomDetail:
        typeof nextState?.symptomDetail === 'string'
          ? nextState.symptomDetail
          : null,
      finalAiSummary:
        nextState?.finalAiSummary && typeof nextState.finalAiSummary === 'object'
          ? nextState.finalAiSummary
          : null,
    };
  }

  async getMessagesForUser(
    sessionId: number,
    userId: number,
    role: string | undefined,
    cursor?: number,
    limit: number = 20,
  ) {
    await this.chatsService.assertCanAccessSession(sessionId, userId, role);
    return this.getMessages(sessionId, cursor, limit);
  }

  async getMessages(sessionId: number, cursor?: number, limit: number = 20) {
    try {
      const session = await this.prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: { status: true, sessionType: true },
      });

      if (!session) {
        throw new NotFoundException('Phiên chat không tồn tại.');
      }

      let messages = await this.prisma.message.findMany({
        where: {
          sessionId,
          isDeleted: false,
        },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'desc' },
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
            },
          },
        },
      });

      if (messages.length > 0) {
        return messages.reverse();
      }

      if (cursor) {
        return [];
      }

      if (session.sessionType !== SessionType.AI_DIAGNOSIS) {
        return [];
      }

      return this.buildMessagesFromAiLogs(sessionId, limit);
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Lỗi khi tải tin nhắn web chatbot: ' + error.message,
      );
    }
  }

  private async buildMessagesFromAiLogs(sessionId: number, limit: number) {
    const logs = await this.prisma.aiReasoningLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return logs.flatMap((log) => {
      const items: Array<Record<string, unknown>> = [];

      if (log.userMsg?.trim()) {
        items.push({
          id: -(log.id * 2),
          sessionId,
          senderId: log.userId,
          sender: null,
          type: MessageType.TEXT,
          content: log.userMsg,
          metadata: null,
          isRead: true,
          isDeleted: false,
          createdAt: log.createdAt,
        });
      }

      if (log.aiResponse?.trim()) {
        items.push({
          id: -(log.id * 2 + 1),
          sessionId,
          senderId: null,
          sender: null,
          type: MessageType.TEXT,
          content: log.aiResponse,
          metadata: null,
          isRead: true,
          isDeleted: false,
          createdAt: log.createdAt,
        });
      }

      return items;
    });
  }

  async bookTechnicianFromSession(
    sessionId: number,
    userId: number,
    role: string | undefined,
    dto?: {
      contactName?: string;
      contactPhone?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    await this.chatsService.assertCanAccessSession(sessionId, userId, role);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        sessionType: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat!');
    }

    if (session.sessionType === SessionType.AI_DIAGNOSIS) {
      const latestAiLog = await this.prisma.aiReasoningLog.findFirst({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        select: {
          riskLevel: true,
          nextState: true,
        },
      });

      const nextState =
        latestAiLog?.nextState && typeof latestAiLog.nextState === 'object'
          ? (latestAiLog.nextState as Record<string, any>)
          : null;

      const risk =
        typeof nextState?.risk === 'string'
          ? nextState.risk.toUpperCase()
          : latestAiLog?.riskLevel?.toUpperCase() ?? 'UNKNOWN';
      const canBook =
        typeof nextState?.canBook === 'boolean'
          ? nextState.canBook
          : risk === 'RED';

      if (!canBook || risk !== 'RED') {
        throw new BadRequestException(
          'Phiên tư vấn này chưa đủ điều kiện gọi thợ. Chỉ cho phép đặt thợ khi AI đánh giá rủi ro cao.',
        );
      }
    }

    return this.chatsService.bookTechnician(sessionId, userId, dto);
  }

  async uploadMediaMessage(
    sessionId: number,
    userId: number,
    role: string | undefined,
    file: Express.Multer.File,
    deviceType?: string,
    symptom?: string,
  ) {
    const deviceSwitchResult =
      await this.chatsService.detectDeviceSwitchForSession(
        sessionId,
        userId,
        role,
        {
          deviceType,
          content: file?.originalname,
        },
      );

    if (deviceSwitchResult) {
      return deviceSwitchResult;
    }

    await this.chatsService.assertCanAccessSession(sessionId, userId, role);

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'video/mp4',
      'video/quicktime',
      'video/x-matroska',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Loáº¡i file khÃ´ng há»— trá»£ (${file.mimetype}). Chá»‰ cháº¥p nháº­n: áº¢nh (JPEG, PNG, WebP, HEIC) vÃ  Video (MP4, MOV, MKV).`,
      );
    }

    const maxSize = file.mimetype.startsWith('video/')
      ? 50 * 1024 * 1024
      : 10 * 1024 * 1024;

    if (file.size > maxSize) {
      throw new BadRequestException(
        `File quÃ¡ lá»›n (${(file.size / 1024 / 1024).toFixed(1)}MB). Tá»‘i Ä‘a: 50MB.`,
      );
    }

    const fileUrl = await this.uploadService.uploadFile(file, 'chat-media');
    const type = file.mimetype.startsWith('video/')
      ? MessageType.VIDEO
      : MessageType.IMAGE;

    return this.chatsService.processSessionMessage(
      sessionId,
      userId,
      {
        type,
        content: fileUrl,
        deviceType: deviceType || undefined,
        symptom: symptom || undefined,
        metadata: {
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      },
      role,
    );
  }
}
