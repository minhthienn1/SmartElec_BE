import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { JobStatus, MessageType, UserRole } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatsGateway } from './chats.gateway';
import { JobsService } from '../jobs/jobs.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';

type DeviceSwitchAction = {
  action: 'CREATE_NEW_SESSION' | 'CONTINUE_CURRENT_SESSION';
  label: string;
};

export type DeviceSwitchResult = {
  deviceSwitchDetected: true;
  currentDevice: string | null;
  detectedDevice: string;
  originalContent: string;
  message: string;
  actions: DeviceSwitchAction[];
};

type ChatMessageResult = any;

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    private readonly jobsService: JobsService,
  ) { }

  private readonly logger = new Logger(ChatsService.name);

  private cleanText(value?: string | null): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeDeviceName(deviceType?: string | null): string | null {
    const value = this.cleanText(deviceType);
    if (!value) return null;

    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const aliases: Record<string, string> = {
      'lo vi song': 'lò vi sóng',
      'lò vi sóng': 'lò vi sóng',
      microwave: 'lò vi sóng',

      'may giat': 'máy giặt',
      'máy giặt': 'máy giặt',
      'washing machine': 'máy giặt',

      'tu lanh': 'tủ lạnh',
      'tủ lạnh': 'tủ lạnh',
      fridge: 'tủ lạnh',
      refrigerator: 'tủ lạnh',

      'dieu hoa': 'điều hòa',
      'điều hòa': 'điều hòa',
      'may lanh': 'điều hòa',
      'máy lạnh': 'điều hòa',
      'air conditioner': 'điều hòa',

      tv: 'tivi',
      tivi: 'tivi',

      'bep tu': 'bếp từ',
      'bếp từ': 'bếp từ',
    };

    return aliases[normalized] ?? value.toLowerCase();
  }

  private isDifferentDevice(
    currentDevice?: string | null,
    incomingDevice?: string | null,
  ): boolean {
    const current = this.normalizeDeviceName(currentDevice);
    const incoming = this.normalizeDeviceName(incomingDevice);

    if (!current || !incoming) {
      return false;
    }

    return current !== incoming;
  }

  private deriveSessionTitle(session: {
    deviceType?: string | null;
    symptom?: string | null;
  }): string {
    if (session.deviceType && session.symptom) {
      return `${session.deviceType} ${session.symptom}`;
    }

    if (session.deviceType) {
      return `Tư vấn ${session.deviceType}`;
    }

    return 'Phiên tư vấn mới';
  }

  private buildDeviceSwitchResult(
    currentDevice: string,
    detectedDevice: string,
    originalContent: string,
  ): DeviceSwitchResult {
    return {
      deviceSwitchDetected: true,
      currentDevice,
      detectedDevice,
      originalContent,
      message: `Phiên này đang tư vấn cho ${currentDevice}. Vấn đề ${detectedDevice} nên tạo phiên mới để không lẫn thông tin chẩn đoán.`,
      actions: [
        {
          action: 'CREATE_NEW_SESSION',
          label: `Tạo phiên mới cho ${detectedDevice}`,
        },
        {
          action: 'CONTINUE_CURRENT_SESSION',
          label: `Tiếp tục với ${currentDevice}`,
        },
      ],
    };
  }

  private formatLastMessage(
    message?: {
      id: number;
      content: string;
      type: MessageType;
      createdAt: Date;
      senderId: number | null;
    } | null,
  ) {
    if (!message) {
      return null;
    }

    return {
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      senderId: message.senderId ?? 0,
    };
  }

  private async enrichSessionListItem(
    session: any,
    viewerId: number,
  ): Promise<any> {
    const lastMessage = Array.isArray(session.messages)
      ? this.formatLastMessage(session.messages[0] ?? null)
      : null;

    const unreadCount = await this.prisma.message.count({
      where: {
        sessionId: session.id,
        isDeleted: false,
        isRead: false,
        senderId: { not: viewerId },
      },
    });

    return {
      ...session,
      title: this.deriveSessionTitle(session),
      lastMessage,
      unreadCount,
    };
  }

  async assertCanAccessSession(
    sessionId: number,
    userId: number,
    role?: string,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        technicianId: true,
        status: true,
        assignmentHistories: {
          where: {
            technicianId: userId,
            action: 'MANUAL_CANCEL',
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Phiên chat không tồn tại.');
    }

    const normalizedRole = role?.toUpperCase();

    if (normalizedRole === UserRole.ADMIN) {
      return;
    }

    if (session.userId === userId || session.technicianId === userId) {
      return;
    }

    if (
      normalizedRole === UserRole.TECHNICIAN &&
      session.status === JobStatus.BROADCASTING &&
      session.assignmentHistories.length === 0
    ) {
      return;
    }

    throw new ForbiddenException('Bạn không có quyền truy cập phiên chat này.');
  }

  async createChatSession(userId: number, dto: CreateChatSessionDto) {
    const deviceType = this.cleanText(dto.deviceType);
    const symptom = this.cleanText(dto.symptom);
    const firstMessage = this.cleanText(dto.firstMessage);

    const session = await this.prisma.$transaction(async (tx) => {
      const createdSession = await tx.chatSession.create({
        data: {
          userId,
          technicianId: null,
          status: JobStatus.AI_CONSULTING,
          deviceType: deviceType ?? undefined,
          symptom: symptom ?? undefined,
        },
      });

      if (firstMessage) {
        await tx.message.create({
          data: {
            sessionId: createdSession.id,
            senderId: userId,
            type: MessageType.TEXT,
            content: firstMessage,
            metadata: {
              ...(dto.metadata ?? {}),
              contextDevice: deviceType,
              contextSymptom: symptom,
            },
          },
        });
      }

      return createdSession;
    });

    return {
      ...session,
      title: this.deriveSessionTitle(session),
    };
  }

  async getAccessibleUserSessions(userId: number, role?: string) {
    const normalizedRole = role?.toUpperCase();

    const sessions = await this.prisma.chatSession.findMany({
      where:
        normalizedRole === UserRole.ADMIN
          ? {}
          : normalizedRole === UserRole.TECHNICIAN
            ? {
              OR: [
                { technicianId: userId },
                {
                  status: JobStatus.BROADCASTING,
                  assignmentHistories: {
                    none: {
                      technicianId: userId,
                      action: 'MANUAL_CANCEL',
                    },
                  },
                },
              ],
            }
            : { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
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
            phoneNumber: true,
          },
        },
        review: true,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    return Promise.all(
      sessions.map((session) => this.enrichSessionListItem(session, userId)),
    );
  }

  async getMessagesForUser(
    sessionId: number,
    userId: number,
    role: string | undefined,
    cursor?: number,
    limit: number = 20,
  ) {
    await this.assertCanAccessSession(sessionId, userId, role);
    return this.getMessages(sessionId, cursor, limit);
  }

  async detectDeviceSwitchForSession(
    sessionId: number,
    userId: number,
    role: string | undefined,
    payload: {
      deviceType?: string | null;
      content?: string | null;
    },
  ): Promise<DeviceSwitchResult | null> {
    await this.assertCanAccessSession(sessionId, userId, role);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        deviceType: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Phiên chat không tồn tại.');
    }

    const incomingDevice = this.cleanText(payload.deviceType);

    if (
      !session.deviceType ||
      !incomingDevice ||
      !this.isDifferentDevice(session.deviceType, incomingDevice)
    ) {
      return null;
    }

    return this.buildDeviceSwitchResult(
      session.deviceType,
      incomingDevice,
      this.cleanText(payload.content) ?? payload.content ?? '',
    );
  }

  async processSessionMessage(
    sessionId: number,
    senderId: number,
    dto: SendMessageDto,
    senderRoleOrSocketId?: string,
    senderSocketId?: string,
  ): Promise<ChatMessageResult | DeviceSwitchResult> {
    const normalizedSenderRole = senderRoleOrSocketId?.toUpperCase();

    const senderRole =
      normalizedSenderRole === UserRole.USER ||
        normalizedSenderRole === UserRole.TECHNICIAN ||
        normalizedSenderRole === UserRole.ADMIN
        ? normalizedSenderRole
        : undefined;

    const resolvedSenderSocketId = senderRole
      ? senderSocketId
      : senderRoleOrSocketId;

    await this.assertCanAccessSession(sessionId, senderId, senderRole);

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceType: true,
        symptom: true,
        status: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Phiên chat không tồn tại.');
    }

    if (session.status === JobStatus.BROADCASTING) {
      throw new BadRequestException(
        'Đang phát sóng tìm thợ, vui lòng đợi thợ nhận đơn để tiếp tục nhắn tin.',
      );
    }

    if (
      session.status === JobStatus.COMPLETED ||
      session.status === JobStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Đơn hàng đã đóng, không thể gửi thêm tin nhắn.',
      );
    }

    const incomingDevice = this.cleanText(dto.deviceType);
    const incomingSymptom = this.cleanText(dto.symptom);
    const content = this.cleanText(dto.content) ?? dto.content;

    if (
      session.deviceType &&
      incomingDevice &&
      this.isDifferentDevice(session.deviceType, incomingDevice)
    ) {
      return this.buildDeviceSwitchResult(
        session.deviceType,
        incomingDevice,
        content,
      );
    }

    let effectiveDevice = session.deviceType;
    let effectiveSymptom = session.symptom;

    if (
      (!session.deviceType && incomingDevice) ||
      (!session.symptom && incomingSymptom)
    ) {
      const updatedSession = await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          ...(session.deviceType
            ? {}
            : { deviceType: incomingDevice ?? undefined }),
          ...(session.symptom
            ? {}
            : { symptom: incomingSymptom ?? undefined }),
        },
        select: {
          deviceType: true,
          symptom: true,
        },
      });

      effectiveDevice = updatedSession.deviceType;
      effectiveSymptom = updatedSession.symptom;
    }

    const message = await this.prisma.message.create({
      data: {
        sessionId,
        senderId,
        type: dto.type,
        content,
        metadata: {
          ...(dto.metadata ?? {}),
          contextDevice: effectiveDevice ?? incomingDevice,
          contextSymptom: effectiveSymptom ?? incomingSymptom,
        },
      },
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

    const roomName = `room_${sessionId}`;

    if (resolvedSenderSocketId) {
      this.chatsGateway.server
        .to(roomName)
        .except(resolvedSenderSocketId)
        .emit('new_message', message);
    } else {
      this.chatsGateway.server.to(roomName).emit('new_message', message);
    }

    this.triggerFCMNotification(sessionId, senderId, message).catch((err) =>
      this.logger.error('Lỗi gửi FCM: ' + err.message),
    );

    return message;
  }

  async markMessageAsReadForUser(
    messageId: number,
    userId: number,
    role?: string,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        sessionId: true,
      },
    });

    if (!message) {
      throw new NotFoundException(`Không tìm thấy tin nhắn với ID = ${messageId}`);
    }

    await this.assertCanAccessSession(message.sessionId, userId, role);

    return this.markAsRead(messageId);
  }

  async markAllAsReadForUser(
    sessionId: number,
    userId: number,
    role?: string,
  ) {
    await this.assertCanAccessSession(sessionId, userId, role);
    return this.markAllAsRead(sessionId, userId);
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
    await this.assertCanAccessSession(sessionId, userId, role);
    return this.bookTechnician(sessionId, userId, dto);
  }

  async deleteUserSessionSecure(
    userId: number,
    sessionId: number,
    role?: string,
  ) {
    await this.assertCanAccessSession(sessionId, userId, role);
    return this.deleteUserSession(userId, sessionId);
  }

  async getUserSessions(userId: number) {
    try {
      return await this.prisma.chatSession.findMany({
        where: {
          AND: [
            {
              OR: [{ userId }, { technicianId: userId }],
            },
            {
              technicianId: { not: null },
            },
            {
              OR: [
                {
                  status: {
                    notIn: [JobStatus.COMPLETED, JobStatus.CANCELLED],
                  },
                },
                {
                  AND: [
                    { userId },
                    { status: JobStatus.COMPLETED },
                    { review: { is: null } },
                  ],
                },
              ],
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        include: {
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
              phoneNumber: true,
            },
          },
          review: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
      });
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Lỗi khi tải danh sách phiên chat: ' + error.message,
      );
    }
  }

  async getSessionById(sessionId: number) {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
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
            phoneNumber: true,
          },
        },
        review: true,
      },
    });
  }

  async getMessages(sessionId: number, cursor?: number, limit: number = 20) {
    try {
      const messages = await this.prisma.message.findMany({
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

      return messages.reverse();
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Lỗi khi tải tin nhắn: ' + error.message,
      );
    }
  }

  async sendMessage(
    sessionId: number,
    senderId: number,
    dto: SendMessageDto,
    senderSocketId?: string,
  ) {
    try {
      const currentDevice = dto.deviceType || null;

      const message = await this.prisma.$transaction(async (tx) => {
        const session = await tx.chatSession.findUnique({
          where: { id: sessionId },
          select: {
            status: true,
            deviceType: true,
          },
        });

        if (!session) {
          throw new NotFoundException('Không tìm thấy phiên chat này.');
        }

        if (session.status === JobStatus.BROADCASTING) {
          throw new BadRequestException(
            'Đang phát sóng tìm thợ, vui lòng đợi thợ nhận đơn để tiếp tục nhắn tin.',
          );
        }

        if (
          session.status === JobStatus.COMPLETED ||
          session.status === JobStatus.CANCELLED
        ) {
          throw new BadRequestException(
            'Đơn hàng đã đóng, không thể gửi thêm tin nhắn.',
          );
        }

        return tx.message.create({
          data: {
            sessionId,
            senderId,
            type: dto.type,
            content: dto.content,
            metadata: dto.metadata
              ? {
                ...dto.metadata,
                contextDevice: currentDevice || session.deviceType,
              }
              : currentDevice || session.deviceType
                ? {
                  contextDevice: currentDevice || session.deviceType,
                }
                : undefined,
          },
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
      });

      const roomName = `room_${sessionId}`;

      if (senderSocketId) {
        this.chatsGateway.server
          .to(roomName)
          .except(senderSocketId)
          .emit('new_message', message);
      } else {
        this.chatsGateway.server.to(roomName).emit('new_message', message);
      }

      this.triggerFCMNotification(sessionId, senderId, message).catch((err) =>
        this.logger.error('❌ Lỗi gửi FCM:', err.message),
      );

      return message;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Lỗi khi gửi tin nhắn: ' + error.message,
      );
    }
  }

  async markAsRead(messageId: number) {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        throw new NotFoundException(
          `Không tìm thấy tin nhắn với ID = ${messageId}`,
        );
      }

      if (message.isRead) return message;

      return await this.prisma.message.update({
        where: { id: messageId },
        data: { isRead: true },
      });
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;

      throw new InternalServerErrorException(
        'Lỗi khi đánh dấu đã xem: ' + error.message,
      );
    }
  }

  async markAllAsRead(sessionId: number, userId: number) {
    return this.prisma.message.updateMany({
      where: {
        sessionId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async createQuote(
    sessionId: number,
    technicianId: number,
    dto: CreateQuoteDto,
  ) {
    const quote = await this.prisma.quote.create({
      data: {
        sessionId,
        technicianId,
        title: dto.title,
        amount: dto.amount,
        expectedTime: dto.expectedTime,
      },
    });

    const quoteMessage = await this.prisma.message.create({
      data: {
        sessionId,
        senderId: technicianId,
        type: MessageType.QUOTE_CARD,
        content: `Báo giá mới cho: ${dto.title}`,
        metadata: {
          quoteId: quote.id,
          amount: dto.amount,
          title: dto.title,
          expectedTime: dto.expectedTime,
          quoteStatus: 'PENDING',
        },
      },
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

    this.chatsGateway.emitToRoom(sessionId, 'new_message', quoteMessage);

    return {
      quote,
      message: quoteMessage,
    };
  }

  async updateQuoteStatus(
    messageId: number,
    userId: number,
    status: 'ACCEPTED' | 'REJECTED',
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { session: true },
    });

    if (!message || message.type !== MessageType.QUOTE_CARD) {
      throw new NotFoundException('Không tìm thấy thẻ báo giá này.');
    }

    if (message.session.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền duyệt báo giá này!');
    }

    const metadata = message.metadata as Record<string, any>;
    const quoteId = metadata?.quoteId;

    const quote = await this.prisma.quote.update({
      where: { id: quoteId },
      data: {
        status,
        ...(status === 'ACCEPTED'
          ? { acceptedAt: new Date() }
          : { rejectedAt: new Date() }),
      },
    });

    if (status === 'ACCEPTED') {
      await this.prisma.chatSession.update({
        where: { id: message.sessionId },
        data: { status: JobStatus.IN_PROGRESS },
      });

      this.chatsGateway.emitToRoom(message.sessionId, 'job_status_changed', {
        sessionId: message.sessionId,
        status: JobStatus.IN_PROGRESS,
      });
    }

    const updatedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...metadata,
          quoteStatus: status,
        },
      },
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

    this.chatsGateway.emitToRoom(message.sessionId, 'quote_updated', {
      messageId,
      status,
      message: updatedMessage,
    });

    const sessionForTechFCM = await this.prisma.chatSession.findUnique({
      where: { id: message.sessionId },
      select: { technicianId: true },
    });

    if (sessionForTechFCM?.technicianId) {
      const tech = await this.prisma.user.findUnique({
        where: { id: sessionForTechFCM.technicianId },
        select: { fcmToken: true },
      });

      if (tech?.fcmToken) {
        this.notificationsService
          .sendNotification({
            token: tech.fcmToken,
            title:
              status === 'ACCEPTED'
                ? '✅ Khách đã chốt giá!'
                : '❌ Khách từ chối báo giá',
            body:
              status === 'ACCEPTED'
                ? 'Tuyệt vời, khách đã đồng ý! Bạn có thể bắt đầu làm.'
                : 'Khách hàng không đồng ý với mức giá này.',
            channelId: 'job_alerts',
            data: {
              type: 'QUOTE_UPDATED',
              sessionId: message.sessionId.toString(),
              quoteStatus: status,
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          })
          .catch((err) => this.logger.error(`FCM Lỗi Quote: ${err.message}`));
      }
    }

    return {
      quote,
      message: updatedMessage,
    };
  }

  async bookTechnician(
    sessionId: number,
    userId: number,
    dto?: {
      contactName?: string;
      contactPhone?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat!');
    }

    if (session.userId !== userId) {
      throw new BadRequestException('Bạn không có quyền chốt đơn này.');
    }

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.BROADCASTING,
        updatedAt: new Date(),
        contactName: dto?.contactName || session.contactName,
        contactPhone: dto?.contactPhone || session.contactPhone,
        address: dto?.address || session.address,
        latitude: dto?.latitude !== undefined ? dto.latitude : session.latitude,
        longitude:
          dto?.longitude !== undefined ? dto.longitude : session.longitude,
      },
    });

    this.chatsGateway.emitGlobal('new_broadcast_job', {
      sessionId: updated.id,
      deviceType: updated.deviceType,
      symptom: updated.symptom,
      aiSummary: updated.aiSummary,
      createdAt: updated.createdAt,
      version: updated.version,
      address: updated.address,
      contactName: updated.contactName,
      contactPhone: updated.contactPhone,
      user: {
        id: session.userId,
        fullName: session.user?.fullName || 'Khách hàng',
        avatarUrl: session.user?.avatarUrl,
      },
    });

    await this.jobsService.addJobDispatch(updated.id, 1);

    return updated;
  }

  async getBroadcastJobs(technicianId: number) {
    return this.prisma.chatSession.findMany({
      where: {
        status: JobStatus.BROADCASTING,
        assignmentHistories: {
          none: {
            technicianId,
            action: 'MANUAL_CANCEL',
          },
        },
      },
      select: {
        id: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        createdAt: true,
        version: true,
        address: true,
        contactName: true,
        contactPhone: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptJob(
    sessionId: number,
    technicianId: number,
    currentVersion: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "chat_sessions" WHERE id = ${sessionId} FOR UPDATE`;

      if (!jobs || jobs.length === 0) {
        throw new HttpException(
          'Không tìm thấy đơn hàng!',
          HttpStatus.NOT_FOUND,
        );
      }

      const job = jobs[0];

      if (job.status !== JobStatus.BROADCASTING) {
        throw new BadRequestException('Đơn hàng đã có người nhận');
      }

      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          status: JobStatus.MATCHED,
          technicianId,
          version: { increment: 1 },
        },
      });

      await tx.sessionAssignmentHistory.create({
        data: {
          chatSessionId: sessionId,
          technicianId,
          action: 'ASSIGNED',
        },
      });

      this.chatsGateway.emitToRoom(sessionId, 'job_accepted', {
        sessionId,
        technicianId,
        status: JobStatus.MATCHED,
      });

      const customer = await tx.user.findUnique({
        where: { id: job.userId },
        select: { fcmToken: true },
      });

      const tech = await tx.user.findUnique({
        where: { id: technicianId },
        select: { fullName: true },
      });

      if (customer?.fcmToken) {
        this.notificationsService
          .sendNotification({
            token: customer.fcmToken,
            title: 'Thợ đã nhận đơn! 🎉',
            body: `Thợ ${tech?.fullName || 'sửa chữa'} đã nhận đơn của bạn. Mở app để trao đổi nhé!`,
            channelId: 'job_alerts',
            data: {
              type: 'JOB_ACCEPTED',
              sessionId: sessionId.toString(),
              technicianId: technicianId.toString(),
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
          })
          .catch((err) =>
            this.logger.error(
              `Lỗi gửi FCM Khách Hàng (JOB_ACCEPTED): ${err.message}`,
            ),
          );
      }

      return {
        success: true,
        message: 'Nhận đơn thành công!',
      };
    });
  }

  private async triggerFCMNotification(
    sessionId: number,
    senderId: number,
    message: any,
  ) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        technicianId: true,
      },
    });

    if (!session) return;

    const recipientId =
      senderId === session.userId ? session.technicianId : session.userId;

    if (!recipientId) return;

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: {
        fcmToken: true,
        fullName: true,
      },
    });

    if (!recipient?.fcmToken) return;

    const title = message.sender?.fullName || 'Tin nhắn mới';

    let body = message.content;

    if (message.type === MessageType.IMAGE) body = '📷 Đã gửi một ảnh';
    if (message.type === MessageType.VIDEO) body = '🎥 Đã gửi một video';
    if (message.type === MessageType.QUOTE_CARD) body = '📄 Đã gửi báo giá mới';

    try {
      this.logger.log(
        `🔔 Đang gửi Push Notification tới User #${recipientId} (${recipient.fullName})`,
      );

      await this.notificationsService.sendNotification({
        token: recipient.fcmToken,
        title,
        body,
        channelId: 'chat_messages_v2',
        data: {
          type: 'chat',
          sessionId: sessionId.toString(),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `❌ Lỗi gửi FCM tới User #${recipientId}: ${err.message}`,
      );
    }
  }

  private readonly BROADCAST_EXPIRE_MINUTES = 120;
  private readonly EMPTY_AI_SESSION_EXPIRE_HOURS = 3;

  @Cron('0 */30 * * * *')
  async handleDeleteIdleEmptyAiSessions() {
    const expireTime = new Date(
      Date.now() - this.EMPTY_AI_SESSION_EXPIRE_HOURS * 60 * 60 * 1000,
    );

    const staleSessions = await this.prisma.chatSession.findMany({
      where: {
        status: JobStatus.AI_CONSULTING,
        technicianId: null,
        updatedAt: { lt: expireTime },
        messages: { none: {} },
        quotes: { none: {} },
        assignmentHistories: { none: {} },
        review: { is: null },
      },
      select: { id: true },
    });

    if (staleSessions.length === 0) return;

    const sessionIds = staleSessions.map((session) => session.id);

    const activeLogSessionIds = new Set(
      (
        await this.prisma.aiReasoningLog.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true },
        })
      )
        .map((log) => log.sessionId)
        .filter((sessionId): sessionId is number => sessionId != null),
    );

    const deletableSessionIds = sessionIds.filter(
      (sessionId) => !activeLogSessionIds.has(sessionId),
    );

    if (deletableSessionIds.length === 0) return;

    await this.prisma.chatSession.deleteMany({
      where: { id: { in: deletableSessionIds } },
    });

    this.logger.log(
      `[Cron] Đã xóa ${deletableSessionIds.length} session trống quá ${this.EMPTY_AI_SESSION_EXPIRE_HOURS} giờ không có tương tác.`,
    );
  }

  @Cron('0 */5 * * * *')
  async handleExpireUnacceptedJobs() {
    const expireTime = new Date(
      Date.now() - this.BROADCAST_EXPIRE_MINUTES * 60 * 1000,
    );

    const expiredSessions = await this.prisma.chatSession.findMany({
      where: {
        status: JobStatus.BROADCASTING,
        createdAt: { lt: expireTime },
      },
    });

    if (expiredSessions.length === 0) return;

    this.logger.log(
      `⏰ [CronJob] Tìm thấy ${expiredSessions.length} đơn quá hạn ${this.BROADCAST_EXPIRE_MINUTES} phút không có thợ nhận, đang tự động hủy...`,
    );

    for (const session of expiredSessions) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          status: JobStatus.CANCELLED,
        },
      });

      this.chatsGateway.emitToRoom(session.id, 'job_status_changed', {
        sessionId: session.id,
        status: JobStatus.CANCELLED,
        message: '🔴 Đơn hàng đã hết hạn do không có thợ nhận.',
      });

      this.logger.log(
        `✅ [CronJob] Đã tự động hủy đơn #${session.id} do quá hạn`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelStalledJobs() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const stalledSessions = await this.prisma.chatSession.findMany({
      where: {
        status: JobStatus.MATCHED,
        updatedAt: { lt: thirtyMinutesAgo },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (stalledSessions.length === 0) return;

    this.logger.log(
      `⏰ [CronJob] Tìm thấy ${stalledSessions.length} đơn quá hạn 30 phút, đang tự động hủy...`,
    );

    for (const session of stalledSessions) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          status: JobStatus.BROADCASTING,
          technicianId: null,
          version: { increment: 1 },
        },
      });

      await this.prisma.sessionAssignmentHistory.create({
        data: {
          chatSessionId: session.id,
          technicianId: session.technicianId,
          action: 'SYSTEM_AUTO_CANCEL',
        },
      });

      this.chatsGateway.emitGlobal('new_broadcast_job', {
        sessionId: session.id,
        deviceType: session.deviceType,
        symptom: session.symptom,
        aiSummary: session.aiSummary,
        createdAt: session.createdAt,
        version: session.version + 1,
        user: {
          id: session.userId,
          fullName: session.user?.fullName || 'Khách hàng',
          avatarUrl: session.user?.avatarUrl,
        },
      });

      this.chatsGateway.emitToRoom(session.id, 'job_status_changed', {
        sessionId: session.id,
        status: JobStatus.BROADCASTING,
        reason: 'AUTO_CANCEL',
        message:
          'Thợ không phản hồi trong 30 phút. Đơn đang được tìm thợ mới...',
      });

      this.logger.log(
        `✅ [CronJob] Đã tự động hủy và phát lại đơn #${session.id}`,
      );
    }
  }

  async completeJob(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy đơn hàng!');
    }

    if (session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền hoàn thành đơn này!');
    }

    if (session.status !== JobStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Chỉ có thể hoàn thành đơn ở trạng thái IN_PROGRESS. Trạng thái hiện tại: ${session.status}`,
      );
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.COMPLETED,
      },
      include: {
        user: {
          select: {
            fcmToken: true,
          },
        },
      },
    });

    this.chatsGateway.emitToRoom(sessionId, 'job_completed', {
      sessionId,
      status: JobStatus.COMPLETED,
      message: '🎉 Đơn hàng đã hoàn thành! Cảm ơn bạn đã sử dụng SmartElec.',
    });

    if (updatedSession.user?.fcmToken) {
      this.notificationsService
        .sendNotification({
          token: updatedSession.user.fcmToken,
          title: 'Hoàn thành sửa chữa! 🎉',
          body: 'Đơn hàng đã xong, mời bạn đánh giá chất lượng dịch vụ.',
          channelId: 'job_alerts',
          data: {
            type: 'JOB_STATUS_UPDATED',
            status: JobStatus.COMPLETED,
            sessionId: sessionId.toString(),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        })
        .catch((err) => this.logger.error(`FCM Lỗi: ${err.message}`));
    }

    return {
      success: true,
      message: 'Xác nhận hoàn thành đơn thành công!',
    };
  }

  async submitReview(
    sessionId: number,
    userId: number,
    dto: {
      rating: number;
      comment?: string;
      tags?: string[];
    },
  ) {
    if (dto.rating < 1 || dto.rating > 5 || !Number.isInteger(dto.rating)) {
      throw new BadRequestException(
        'Điểm đánh giá phải là số nguyên từ 1 đến 5.',
      );
    }

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { review: true },
    });

    if (!session) {
      throw new NotFoundException('Không tìm thấy đơn hàng này.');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền đánh giá đơn hàng này.');
    }

    if (session.status !== JobStatus.COMPLETED) {
      throw new BadRequestException(
        `Chỉ có thể đánh giá đơn đã hoàn thành. Trạng thái hiện tại: ${session.status}`,
      );
    }

    if (!session.technicianId) {
      throw new BadRequestException('Đơn hàng chưa có thợ phụ trách.');
    }

    if (session.review) {
      throw new BadRequestException(
        'Bạn đã gửi đánh giá cho đơn hàng này rồi.',
      );
    }

    const technicianId = session.technicianId;

    const [newReview] = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          sessionId,
          userId,
          technicianId,
          rating: dto.rating,
          comment: dto.comment,
          tags: dto.tags ?? [],
        },
      });

      const aggregate = await tx.review.aggregate({
        where: { technicianId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      const newAvg = aggregate._avg.rating ?? dto.rating;
      const newCount = aggregate._count.rating;

      await tx.user.update({
        where: { id: technicianId },
        data: {
          averageRating: Math.round(newAvg * 10) / 10,
          totalReviews: newCount,
        },
      });

      this.logger.log(
        `⭐ [Review] Đơn #${sessionId} → Thợ #${technicianId} nhận đánh giá ${dto.rating}/5. Trung bình mới: ${newAvg.toFixed(1)} (${newCount} lượt)`,
      );

      return [review];
    });

    this.chatsGateway.emitToRoom(sessionId, 'review_submitted', {
      sessionId,
      rating: dto.rating,
      message: `Khách hàng đã đánh giá bạn ${dto.rating} sao!`,
    });

    return {
      success: true,
      message: 'Gửi đánh giá thành công! Cảm ơn bạn đã sử dụng SmartElec.',
      data: newReview,
    };
  }

  async startRepair(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new BadRequestException(
        'Bạn không có quyền thao tác trên đơn hàng này.',
      );
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.IN_PROGRESS,
        updatedAt: new Date(),
      },
    });

    this.chatsGateway.server.to(`room_${sessionId}`).emit(
      'job_status_changed',
      {
        sessionId,
        status: JobStatus.IN_PROGRESS,
        message: 'Thợ đã bắt đầu sửa chữa.',
      },
    );

    return updatedSession;
  }

  async startEnRoute(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (session.status !== JobStatus.MATCHED) {
      throw new BadRequestException(
        'Chỉ có thể bắt đầu di chuyển khi đơn vừa được nhận.',
      );
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.EN_ROUTE,
      },
      include: {
        user: {
          select: {
            fcmToken: true,
          },
        },
        technician: {
          select: {
            fullName: true,
          },
        },
      },
    });

    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: JobStatus.EN_ROUTE,
      message: '🚀 Thợ đang trên đường di chuyển đến vị trí của bạn!',
    });

    if (updatedSession.user?.fcmToken) {
      this.notificationsService
        .sendNotification({
          token: updatedSession.user.fcmToken,
          title: 'Thợ đang đến!',
          body: `Thợ ${updatedSession.technician?.fullName || ''} đang trên đường đến vị trí của bạn.`,
          channelId: 'job_alerts',
          data: {
            type: 'JOB_STATUS_UPDATED',
            status: JobStatus.EN_ROUTE,
            sessionId: sessionId.toString(),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        })
        .catch((err) => this.logger.error(`FCM Lỗi: ${err.message}`));
    }

    return updatedSession;
  }

  async confirmArrival(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (session.status !== JobStatus.EN_ROUTE) {
      throw new BadRequestException(
        'Chỉ có thể báo đã đến khi đang trong trạng thái di chuyển.',
      );
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.ARRIVED,
      },
      include: {
        user: {
          select: {
            fcmToken: true,
          },
        },
      },
    });

    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: JobStatus.ARRIVED,
      message: '📍 Thợ đã đến vị trí của bạn! Vui lòng chuẩn bị để đón thợ.',
    });

    if (updatedSession.user?.fcmToken) {
      this.notificationsService
        .sendNotification({
          token: updatedSession.user.fcmToken,
          title: 'Thợ đã đến nơi!',
          body: 'Thợ đã đến trước cửa, bạn chú ý điện thoại nhé!',
          channelId: 'job_alerts',
          data: {
            type: 'JOB_STATUS_UPDATED',
            status: JobStatus.ARRIVED,
            sessionId: sessionId.toString(),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        })
        .catch((err) => this.logger.error(`FCM Lỗi: ${err.message}`));
    }

    return updatedSession;
  }

  async cancelJob(sessionId: number, userId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        technician: {
          select: {
            id: true,
            fcmToken: true,
          },
        },
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            fcmToken: true,
          },
        },
      },
    });

    if (
      !session ||
      (session.userId !== userId && session.technicianId !== userId)
    ) {
      throw new ForbiddenException('Bạn không có quyền hủy đơn này!');
    }

    const isCustomer = userId === session.userId;

    if (isCustomer) {
      if (session.status === JobStatus.EN_ROUTE) {
        throw new BadRequestException(
          'Thợ đang trên đường đến, bạn không thể tự hủy đơn lúc này. Vui lòng liên hệ trực tiếp với thợ hoặc tổng đài để hỗ trợ.',
        );
      }

      const updatedSession = await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          status: JobStatus.CANCELLED,
        },
      });

      if (session.technicianId && session.technician?.fcmToken) {
        await this.notificationsService.sendNotification({
          token: session.technician.fcmToken,
          title: '⚠️ ĐƠN HÀNG BỊ HỦY! 🛑',
          body: 'Khách hàng vừa hủy đơn hàng. Vui lòng DỪNG DI CHUYỂN và quay đầu xe ngay lập tức!',
          channelId: 'job_alerts',
          data: {
            type: 'JOB_CANCELLED',
            sessionId: sessionId.toString(),
          },
        });
      }

      this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
        sessionId,
        status: JobStatus.CANCELLED,
        message: '🔴 Đơn hàng đã bị hủy bởi Khách hàng.',
      });

      return updatedSession;
    }

    if (
      session.status !== JobStatus.MATCHED &&
      session.status !== JobStatus.EN_ROUTE &&
      session.status !== JobStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        'Chỉ có thể hủy đơn đang trong quá trình thực hiện.',
      );
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.BROADCASTING,
        technicianId: null,
        version: { increment: 1 },
      },
    });

    await this.prisma.sessionAssignmentHistory.create({
      data: {
        chatSessionId: sessionId,
        technicianId: userId,
        action: 'MANUAL_CANCEL',
      },
    });

    const updated = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    this.chatsGateway.emitGlobal('new_broadcast_job', {
      sessionId: session.id,
      deviceType: session.deviceType,
      symptom: session.symptom,
      aiSummary: session.aiSummary,
      createdAt: session.createdAt,
      version: updated?.version,
      user: {
        id: session.userId,
        fullName: session.user.fullName || 'Khách hàng',
        avatarUrl: session.user.avatarUrl,
      },
    });

    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: JobStatus.BROADCASTING,
      message: 'Thợ vừa hủy đơn. Hệ thống đang tìm thợ mới cho bạn...',
    });

    return {
      success: true,
      message: 'Thợ đã hủy đơn thành công. Đơn đang được tìm người mới.',
    };
  }

  async redispatchJob(sessionId: number, userId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (
      session.status !== JobStatus.MATCHED &&
      session.status !== JobStatus.EN_ROUTE
    ) {
      throw new BadRequestException(
        'Chỉ có thể tìm thợ khác khi đơn chưa bắt đầu sửa.',
      );
    }

    if (session.technicianId) {
      await this.prisma.sessionAssignmentHistory.create({
        data: {
          chatSessionId: sessionId,
          technicianId: session.technicianId,
          action: 'UNASSIGNED',
        },
      });
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: JobStatus.BROADCASTING,
        technicianId: null,
      },
    });

    await this.jobsService.addJobDispatch(sessionId, 1, 0);

    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: JobStatus.BROADCASTING,
      message: '🔎 Đang tìm thợ mới cho bạn...',
    });

    return updatedSession;
  }

  @Cron('0 * * * *')
  async handleAutoCompleteOldJobs() {
    this.logger.log('🧹 [Cron] Đang quét các đơn hàng bị treo quá 72h...');

    const threshold = new Date();
    threshold.setHours(threshold.getHours() - 72);

    const staleSessions = await this.prisma.chatSession.findMany({
      where: {
        status: JobStatus.IN_PROGRESS,
        updatedAt: { lt: threshold },
      },
    });

    if (staleSessions.length === 0) return;

    for (const session of staleSessions) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          status: JobStatus.COMPLETED,
        },
      });

      this.logger.log(
        `✅ [Cron] Tự động đóng đơn #${session.id} (Treo > 72h)`,
      );
    }
  }

  async deleteUserSession(userId: number, sessionId: number) {
    try {
      const session = await this.prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          userId,
        },
      });

      if (!session) {
        throw new NotFoundException('Dạ không tìm thấy ca chẩn đoán này ạ!');
      }

      await this.prisma.aiReasoningLog.deleteMany({
        where: { sessionId },
      });

      await this.prisma.message.deleteMany({
        where: { sessionId },
      });

      await this.prisma.chatSession.delete({
        where: { id: sessionId },
      });

      return {
        success: true,
        message: 'Đã xóa ca chẩn đoán thành công.',
      };
    } catch (error) {
      this.logger.error(`Lỗi khi xóa session ${sessionId}:`, error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Không thể xóa ca chẩn đoán.');
    }
  }

  async deleteBulkUserSessions(userId: number, ids: number[]) {
    if (!ids || ids.length === 0) {
      return {
        success: true,
        deleted: 0,
      };
    }

    try {
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          id: { in: ids },
          userId,
        },
        select: {
          id: true,
        },
      });

      const validIds = sessions.map((session) => session.id);

      if (validIds.length === 0) {
        throw new NotFoundException('Không tìm thấy phiên nào thuộc về bạn.');
      }

      await this.prisma.aiReasoningLog.deleteMany({
        where: {
          sessionId: { in: validIds },
        },
      });

      await this.prisma.message.deleteMany({
        where: {
          sessionId: { in: validIds },
        },
      });

      const result = await this.prisma.chatSession.deleteMany({
        where: {
          id: { in: validIds },
        },
      });

      return {
        success: true,
        deleted: result.count,
      };
    } catch (error) {
      this.logger.error('Lỗi khi xóa hàng loạt session:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Không thể xóa các ca chẩn đoán.');
    }
  }

  async getUserRepairHistory(userId: number) {
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        userId,
        technicianId: { not: null },
        status: {
          in: [JobStatus.COMPLETED],
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        technician: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            averageRating: true,
          },
        },
        review: true,
        quotes: {
          where: {
            status: 'ACCEPTED',
          },
        },
      },
    });

    return sessions.map((session) => {
      const acceptedQuote =
        session.quotes.length > 0 ? session.quotes[0] : null;

      return {
        id: session.id.toString(),
        title: session.deviceType || 'Sửa chữa thiết bị',
        date: session.updatedAt.toISOString(),
        chatSummary:
          session.aiSummary || 'Đã thống nhất giá và hoàn tất sửa chữa.',
        status: session.status,

        mechanicName: session.technician?.fullName || 'Thợ sửa chữa',
        mechanicPhone: session.technician?.phoneNumber || 'Chưa cập nhật',

        rating:
          session.review?.rating || session.technician?.averageRating || 5.0,

        reviewComment: session.review?.comment || null,

        agreedPrice: acceptedQuote
          ? `${acceptedQuote.amount.toLocaleString('vi-VN')} đ`
          : 'Chưa chốt giá',
      };
    });
  }
}
