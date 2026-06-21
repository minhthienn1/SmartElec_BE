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
import { MessageType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatsGateway } from './chats.gateway';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    private readonly jobsService: JobsService,
  ) {}

  private readonly logger = new Logger(ChatsService.name);

  // 0. LẤY DANH SÁCH PHIÊN CHAT CỦA USER (Hộp thư)
  async getUserSessions(userId: number) {
    try {
      return await this.prisma.chatSession.findMany({
        where: {
          AND: [
            { OR: [{ userId: userId }, { technicianId: userId }] },
            { technicianId: { not: null } },
            {
              OR: [
                { status: { notIn: ['COMPLETED', 'CANCELLED'] } }, // Đang làm (không phải COMPLETED hay CANCELLED) thì hiện cho cả 2
                {
                  AND: [
                    { userId: userId }, // Chỉ Khách hàng mới thấy đơn COMPLETED
                    { status: 'COMPLETED' },
                    { review: { is: null } }, // Và chỉ khi chưa đánh giá
                  ],
                },
              ],
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          technician: { select: { id: true, fullName: true, avatarUrl: true, role: true, phoneNumber:true } },
          review: true, // Thêm include review để check
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { id: true, fullName: true } } },
          },
        },
      });
    } catch (error:any) {
      throw new InternalServerErrorException('Lỗi khi tải danh sách phiên chat: ' + error.message);
    }
  }

  async getSessionById(sessionId: number) {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        technician: { select: { id: true, fullName: true, avatarUrl: true, role: true, phoneNumber: true } },
        review: true,
      },
    });
  }

  // 1. LẤY DANH SÁCH TIN NHẮN (Cursor-based Pagination)
  async getMessages(sessionId: number, cursor?: number, limit: number = 20) {
    try {
      const messages = await this.prisma.message.findMany({
        where: { sessionId, isDeleted: false },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'desc' },
        include: {
          sender: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        },
      });
      return messages.reverse();
    } catch (error:any) {
      throw new InternalServerErrorException('Lỗi khi tải tin nhắn: ' + error.message);
    }
  }

  async sendMessage(sessionId: number, senderId: number, dto: SendMessageDto, senderSocketId?: string) {
    try {
      const currentDevice = dto.deviceType || null;

      // 1. TRANSACTION ĐỂ XỬ LÝ RACE CONDITION
      const message = await this.prisma.$transaction(async (tx) => {
        const session = await tx.chatSession.findUnique({
          where: { id: sessionId },
          select: { status: true, deviceType: true }
        });

        if (!session) {
          throw new NotFoundException('Không tìm thấy phiên chat này.');
        }

        if (session.status === 'BROADCASTING') {
          throw new BadRequestException('Đang phát sóng tìm thợ, vui lòng đợi thợ nhận đơn để tiếp tục nhắn tin.');
        }

        if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
          throw new BadRequestException('Đơn hàng đã đóng, không thể gửi thêm tin nhắn.');
        }

        return await tx.message.create({
          data: {
            sessionId,
            senderId,
            type: dto.type,
            content: dto.content,
            metadata: dto.metadata 
              ? { ...dto.metadata, contextDevice: currentDevice || session.deviceType } 
              : (currentDevice || session.deviceType ? { contextDevice: currentDevice || session.deviceType } : undefined),
          },
          include: {
            sender: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
          },
        });
      });

      // 2. BROADCAST VÀ GỬI FCM
      const roomName = `room_${sessionId}`;
      if (senderSocketId) {
        this.chatsGateway.server
          .to(roomName)
          .except(senderSocketId)
          .emit('new_message', message);
      } else {
        this.chatsGateway.server.to(roomName).emit('new_message', message);
      }

      this.triggerFCMNotification(sessionId, senderId, message).catch(err => 
        this.logger.error('❌ Lỗi gửi FCM:', err.message)
      );

      return message;
    } catch (error:any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Lỗi khi gửi tin nhắn: ' + error.message);
    }
  }

  // 3. ĐÁNH DẤU TIN NHẮN ĐÃ XEM
  async markAsRead(messageId: number) {
    try {
      const message = await this.prisma.message.findUnique({ where: { id: messageId } });
      if (!message) throw new NotFoundException(`Không tìm thấy tin nhắn với ID = ${messageId}`);
      if (message.isRead) return message;

      return await this.prisma.message.update({
        where: { id: messageId },
        data: { isRead: true },
      });
    } catch (error:any) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Lỗi khi đánh dấu đã xem: ' + error.message);
    }
  }

  async markAllAsRead(sessionId: number, userId: number) {
    return this.prisma.message.updateMany({
      where: {
        sessionId: sessionId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  // 4. HỆ THỐNG BÁO GIÁ (QUOTATION)
  async createQuote(sessionId: number, technicianId: number, dto: CreateQuoteDto) {
    const quote = await this.prisma.quote.create({
      data: { sessionId, technicianId, title: dto.title, amount: dto.amount },
    });

    const quoteMessage = await this.prisma.message.create({
      data: {
        sessionId,
        senderId: technicianId,
        type: 'QUOTE_CARD',
        content: `Báo giá mới cho: ${dto.title}`,
        metadata: { quoteId: quote.id, amount: dto.amount, title: dto.title, quoteStatus: 'PENDING' },
      },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true, role: true } } },
    });

    this.chatsGateway.emitToRoom(sessionId, 'new_message', quoteMessage);
    return { quote, message: quoteMessage };
  }

  async updateQuoteStatus(messageId: number, userId: number, status: 'ACCEPTED' | 'REJECTED') {
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
        status: status,
        ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : { rejectedAt: new Date() }),
      },
    });

    if (status === 'ACCEPTED') {
      await this.prisma.chatSession.update({
        where: { id: message.sessionId },
        data: { status: 'IN_PROGRESS' },
      });
      this.chatsGateway.emitToRoom(message.sessionId, 'job_status_changed', {
        sessionId: message.sessionId,
        status: 'IN_PROGRESS',
      });
    }

    const updatedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, quoteStatus: status } },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true, role: true } } },
    });

    this.chatsGateway.emitToRoom(message.sessionId, 'quote_updated', {
      messageId: messageId,
      status: status,
      message: updatedMessage,
    });

    return { quote, message: updatedMessage };
  }

  // 5. CHỐT ĐƠN ĐẶT THỢ (Transition to BROADCASTING)
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
      include: { user: true }
    });
    if (!session) throw new NotFoundException(`Không tìm thấy phiên chat!`);
    if (session.userId !== userId) throw new BadRequestException('Bạn không có quyền chốt đơn này.');

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { 
        status: 'BROADCASTING', 
        updatedAt: new Date(),
        contactName: dto?.contactName || session.contactName,
        contactPhone: dto?.contactPhone || session.contactPhone,
        address: dto?.address || session.address,
        latitude: dto?.latitude !== undefined ? dto.latitude : session.latitude,
        longitude: dto?.longitude !== undefined ? dto.longitude : session.longitude,
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
        fullName: (session as any).user?.fullName || 'Khách hàng',
        avatarUrl: (session as any).user?.avatarUrl,
      },
    });
    
    // KÍCH HOẠT HÀNG ĐỢI PHÂN BỔ ĐƠN HÀNG (Attempt 1)
    await this.jobsService.addJobDispatch(updated.id, 1);

    return updated;
  }

  // 6. API CHO THỢ (JOB BOARD & ACCEPT)
  async getBroadcastJobs(technicianId: number) {
    return this.prisma.chatSession.findMany({
      where: {
        status: 'BROADCASTING',
        assignmentHistories: {
          none: {
            technicianId: technicianId,
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
        user: { select: { id: true, fullName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptJob(sessionId: number, technicianId: number, currentVersion: number) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Tìm và Khóa dòng dữ liệu (Pessimistic Locking)
      const jobs = await tx.$queryRaw<any[]>`SELECT * FROM "chat_sessions" WHERE id = ${sessionId} FOR UPDATE`;
      
      if (!jobs || jobs.length === 0) {
        throw new HttpException('Không tìm thấy đơn hàng!', HttpStatus.NOT_FOUND);
      }
      
      const job = jobs[0];

      // 2. Kiểm tra trạng thái (tương đương WAITING trong yêu cầu)
      if (job.status !== 'BROADCASTING') {
        throw new BadRequestException('Đơn hàng đã có người nhận');
      }

      // 3. Cập nhật đơn hàng (tương đương ACCEPTED)
      await tx.chatSession.update({
        where: { id: sessionId },
        data: { status: 'MATCHED', technicianId: technicianId, version: { increment: 1 } },
      });

      // 4. Lưu lịch sử
      await tx.sessionAssignmentHistory.create({
        data: { chatSessionId: sessionId, technicianId: technicianId, action: 'ASSIGNED' },
      });

      // 5. Bắn socket (bên ngoài hoặc cuối transaction)
      this.chatsGateway.emitToRoom(sessionId, 'job_accepted', {
        sessionId,
        technicianId,
        status: 'MATCHED',
      });

      return { success: true, message: 'Nhận đơn thành công!' };
    });
  }



  // Private Helper cho FCM
  private async triggerFCMNotification(sessionId: number, senderId: number, message: any) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, technicianId: true },
    });
    if (!session) return;

    const recipientId = senderId === session.userId ? session.technicianId : session.userId;
    if (!recipientId) return;

    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { fcmToken: true, fullName: true },
    });
    if (!recipient || !recipient.fcmToken) return;

    const title = message.sender?.fullName || 'Tin nhắn mới';
    let body = message.content;
    if (message.type === MessageType.IMAGE) body = '📷 Đã gửi một ảnh';
    if (message.type === MessageType.VIDEO) body = '🎥 Đã gửi một video';
    if (message.type === MessageType.QUOTE_CARD) body = '📄 Đã gửi báo giá mới';

    try {
      this.logger.log(`🔔 Đang gửi Push Notification tới User #${recipientId} (${recipient.fullName})`);
      await this.notificationsService.sendNotification({
        token: recipient.fcmToken,
        title: title,
        body: body,
        channelId: 'chat_messages_v2', // Kênh chat của Flutter
        data: {
          type: 'chat',
          sessionId: sessionId.toString(),
        },
      });
    } catch (err:any) {
      this.logger.error(`❌ Lỗi gửi FCM tới User #${recipientId}: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 1: CRON JOB - TỰ ĐỘNG HỦY ĐƠN SAU 30 PHÚT
  // ─────────────────────────────────────────────────────────────────
  private readonly BROADCAST_EXPIRE_MINUTES = 120; // Đổi thành 5 để demo

  @Cron('0 */5 * * * *') // EVERY 5 MINUTES
  async handleExpireUnacceptedJobs() {
    const expireTime = new Date(Date.now() - this.BROADCAST_EXPIRE_MINUTES * 60 * 1000);

    const expiredSessions = await this.prisma.chatSession.findMany({
      where: {
        status: 'BROADCASTING',
        createdAt: { lt: expireTime },
      },
    });

    if (expiredSessions.length === 0) return;

    this.logger.log(`⏰ [CronJob] Tìm thấy ${expiredSessions.length} đơn quá hạn ${this.BROADCAST_EXPIRE_MINUTES} phút không có thợ nhận, đang tự động hủy...`);

    for (const session of expiredSessions) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          status: 'CANCELLED',
        },
      });

      this.chatsGateway.emitToRoom(session.id, 'job_status_changed', {
        sessionId: session.id,
        status: 'CANCELLED',
        message: '🔴 Đơn hàng đã hết hạn do không có thợ nhận.',
      });

      this.logger.log(`✅ [CronJob] Đã tự động hủy đơn #${session.id} do quá hạn`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelStalledJobs() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const stalledSessions = await this.prisma.chatSession.findMany({
      where: {
        status: 'MATCHED',
        updatedAt: { lt: thirtyMinutesAgo },
      },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });

    if (stalledSessions.length === 0) return;

    this.logger.log(`⏰ [CronJob] Tìm thấy ${stalledSessions.length} đơn quá hạn 30 phút, đang tự động hủy...`);

    for (const session of stalledSessions) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          status: 'BROADCASTING',
          technicianId: null,
          version: { increment: 1 },
        },
      });

      // Ghi log lịch sử
      await this.prisma.sessionAssignmentHistory.create({
        data: {
          chatSessionId: session.id,
          technicianId: session.technicianId!,
          action: 'SYSTEM_AUTO_CANCEL',
        },
      });

      // Phát đơn lại cho tất cả thợ
      this.chatsGateway.emitGlobal('new_broadcast_job', {
        sessionId: session.id,
        deviceType: session.deviceType,
        symptom: session.symptom,
        aiSummary: session.aiSummary,
        createdAt: session.createdAt,
        version: session.version + 1,
        user: {
          id: session.userId,
          fullName: (session as any).user?.fullName || 'Khách hàng',
          avatarUrl: (session as any).user?.avatarUrl,
        },
      });

      // Thông báo cho phòng chat biết đơn đã bị hủy
      this.chatsGateway.emitToRoom(session.id, 'job_status_changed', {
        sessionId: session.id,
        status: 'BROADCASTING',
        reason: 'AUTO_CANCEL',
        message: 'Thợ không phản hồi trong 30 phút. Đơn đang được tìm thợ mới...',
      });

      this.logger.log(`✅ [CronJob] Đã tự động hủy và phát lại đơn #${session.id}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 3: GỬI TIN NHẮN TRONG PHIÊN CHAT
  // ─────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 3: THỢ XÁC NHẬN HOÀN THÀNH ĐƠN
  // ─────────────────────────────────────────────────────────────────
  async completeJob(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new NotFoundException('Không tìm thấy đơn hàng!');
    if (session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền hoàn thành đơn này!');
    }
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Chỉ có thể hoàn thành đơn ở trạng thái IN_PROGRESS (Sau khi khách đã duyệt báo giá). Trạng thái hiện tại: ${session.status}`,
      );
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' },
    });

    // Phát sự kiện vào phòng chat để khóa giao diện nhắn tin
    this.chatsGateway.emitToRoom(sessionId, 'job_completed', {
      sessionId,
      status: 'COMPLETED',
      message: '🎉 Đơn hàng đã hoàn thành! Cảm ơn bạn đã sử dụng SmartElec.',
    });

    return { success: true, message: 'Xác nhận hoàn thành đơn thành công!' };
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 4: KHÁCH HÀNG GỬI ĐÁNH GIÁ SAU KHI HOÀN THÀNH
  // ─────────────────────────────────────────────────────────────────
  async submitReview(
    sessionId: number,
    userId: number,
    dto: { rating: number; comment?: string; tags?: string[] },
  ) {
    // [GUARD 1] Kiểm tra rating hợp lệ
    if (dto.rating < 1 || dto.rating > 5 || !Number.isInteger(dto.rating)) {
      throw new BadRequestException('Điểm đánh giá phải là số nguyên từ 1 đến 5.');
    }

    // [GUARD 2] Kiểm tra session tồn tại và đúng chủ
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
    if (session.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Chỉ có thể đánh giá đơn đã hoàn thành. Trạng thái hiện tại: ${session.status}`,
      );
    }
    if (!session.technicianId) {
      throw new BadRequestException('Đơn hàng chưa có thợ phụ trách.');
    }

    // [GUARD 3] Kiểm tra đã đánh giá chưa (tránh spam)
    if (session.review) {
      throw new BadRequestException('Bạn đã gửi đánh giá cho đơn hàng này rồi.');
    }

    // [TRANSACTION] Tạo review và cập nhật cache điểm thợ trong 1 giao dịch
    const technicianId = session.technicianId;

    const [newReview] = await this.prisma.$transaction(async (tx) => {
      // Bước 1: Tạo bản ghi Review mới
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

      // Bước 2: Tính toán lại điểm trung bình sau khi thêm review mới
      const aggregate = await tx.review.aggregate({
        where: { technicianId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      const newAvg = aggregate._avg.rating ?? dto.rating;
      const newCount = aggregate._count.rating;

      // Bước 3: Cập nhật cache điểm vào bảng User của thợ
      await tx.user.update({
        where: { id: technicianId },
        data: {
          averageRating: Math.round(newAvg * 10) / 10, // Làm tròn 1 chữ số thập phân
          totalReviews: newCount,
        },
      });

      this.logger.log(
        `⭐ [Review] Đơn #${sessionId} → Thợ #${technicianId} nhận đánh giá ${dto.rating}/5. Trung bình mới: ${newAvg.toFixed(1)} (${newCount} lượt)`,
      );

      return [review];
    });

    // Thông báo qua Socket cho thợ biết vừa nhận được đánh giá
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
    // 1. Kiểm tra session có tồn tại và đúng thợ không
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new BadRequestException('Bạn không có quyền thao tác trên đơn hàng này.');
    }

    // 2. Cập nhật trạng thái thành IN_PROGRESS
    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: 'IN_PROGRESS',
        updatedAt: new Date(),
      },
    });

    // 3. Emit qua Socket để Flutter (bên Khách) tự động nhảy trạng thái
    this.chatsGateway.server.to(`room_${sessionId}`).emit('job_status_changed', {
      sessionId: sessionId,
      status: 'IN_PROGRESS',
      message: 'Thợ đã bắt đầu sửa chữa.',
    });

    return updatedSession;
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 4: THỢ BẮT ĐẦU DI CHUYỂN (EN_ROUTE)
  // ─────────────────────────────────────────────────────────────────
  async startEnRoute(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (session.status !== 'MATCHED') {
      throw new BadRequestException('Chỉ có thể bắt đầu di chuyển khi đơn vừa được nhận.');
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { status: 'EN_ROUTE' },
    });

    // Thông báo cho khách biết thợ đang đến
    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: 'EN_ROUTE',
      message: '🚀 Thợ đang trên đường di chuyển đến vị trí của bạn!',
    });

    return updatedSession;
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 4.5: THỢ XÁC NHẬN ĐÃ ĐẾN NƠI (ARRIVED)
  // ─────────────────────────────────────────────────────────────────
  async confirmArrival(sessionId: number, technicianId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.technicianId !== technicianId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (session.status !== 'EN_ROUTE') {
      throw new BadRequestException('Chỉ có thể báo đã đến khi đang trong trạng thái di chuyển.');
    }

    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { status: 'ARRIVED' },
    });

    // Thông báo cho khách biết thợ đã đến
    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: 'ARRIVED',
      message: '📍 Thợ đã đến vị trí của bạn! Vui lòng chuẩn bị để đón thợ.',
    });

    return updatedSession;
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 5: KHÁCH HÀNG HỦY ĐƠN (Cập nhật logic chống "Quay xe")
  // ─────────────────────────────────────────────────────────────────
  async cancelJob(sessionId: number, userId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        technician: { select: { id: true, fcmToken: true } },
        user: { select: { id: true, fullName: true, avatarUrl: true, fcmToken: true } },
      },
    });

    if (!session || (session.userId !== userId && session.technicianId !== userId)) {
      throw new ForbiddenException('Bạn không có quyền hủy đơn này!');
    }

    const isCustomer = userId === session.userId;

    if (isCustomer) {
      // 1. LOGIC CHO KHÁCH HÀNG HỦY ĐƠN
      // CHỐNG QUAY XE: Nếu thợ đang đi (EN_ROUTE) thì không cho khách tự hủy qua app
      if (session.status === 'EN_ROUTE') {
        throw new BadRequestException(
          'Thợ đang trên đường đến, bạn không thể tự hủy đơn lúc này. Vui lòng liên hệ trực tiếp với thợ hoặc tổng đài để hỗ trợ.',
        );
      }

      const updatedSession = await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { status: 'CANCELLED' },
      });

      // PUSH NOTIFICATION CỰC MẠNH CHO THỢ NẾU KHÁCH HỦY
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
        status: 'CANCELLED',
        message: '🔴 Đơn hàng đã bị hủy bởi Khách hàng.',
      });

      return updatedSession;
    } else {
      // 2. LOGIC CHO THỢ HỦY ĐƠN (Trả về BROADCASTING)
      if (!['MATCHED', 'EN_ROUTE', 'IN_PROGRESS'].includes(session.status)) {
        throw new BadRequestException('Chỉ có thể hủy đơn đang trong quá trình thực hiện.');
      }

      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          status: 'BROADCASTING',
          technicianId: null,
          version: { increment: 1 },
        },
      });

      // Ghi lịch sử bùng kèo
      await this.prisma.sessionAssignmentHistory.create({
        data: {
          chatSessionId: sessionId,
          technicianId: userId,
          action: 'MANUAL_CANCEL',
        },
      });

      const updated = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });

      // Phát đơn lại cho các thợ khác
      this.chatsGateway.emitGlobal('new_broadcast_job', {
        sessionId: session.id,
        deviceType: session.deviceType,
        symptom: session.symptom,
        aiSummary: session.aiSummary,
        createdAt: session.createdAt,
        version: updated!.version,
        user: {
          id: session.userId,
          fullName: session.user.fullName || 'Khách hàng',
          avatarUrl: session.user.avatarUrl,
        },
      });

      // Báo cho khách biết thợ đã hủy
      this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
        sessionId: sessionId,
        status: 'BROADCASTING',
        message: 'Thợ vừa hủy đơn. Hệ thống đang tìm thợ mới cho bạn...',
      });

      return { success: true, message: 'Thợ đã hủy đơn thành công. Đơn đang được tìm người mới.' };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 6: KHÁCH HÀNG ĐỔI THỢ (Trị Ghosting)
  // ─────────────────────────────────────────────────────────────────
  async redispatchJob(sessionId: number, userId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này!');
    }

    if (session.status !== 'MATCHED' && session.status !== 'EN_ROUTE') {
      throw new BadRequestException('Chỉ có thể tìm thợ khác khi đơn chưa bắt đầu sửa.');
    }

    // Ghi lại lịch sử bùng kèo (UNASSIGNED) cho thợ cũ
    if (session.technicianId) {
      await this.prisma.sessionAssignmentHistory.create({
        data: {
          chatSessionId: sessionId,
          technicianId: session.technicianId,
          action: 'UNASSIGNED',
        },
      });
    }

    // Đưa đơn về lại trạng thái phát sóng
    const updatedSession = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: 'BROADCASTING',
        technicianId: null, // Đá thợ cũ ra
      },
    });

    // Kích hoạt lại BullMQ để tìm thợ mới
    await this.jobsService.addJobDispatch(sessionId, 1, 0);

    this.chatsGateway.emitToRoom(sessionId, 'job_status_changed', {
      sessionId,
      status: 'BROADCASTING',
      message: '🔎 Đang tìm thợ mới cho bạn...',
    });

    return updatedSession;
  }

  // ─────────────────────────────────────────────────────────────────
  // NHIỆM VỤ 7: TỰ ĐỘNG DỌN RÁC (Auto-complete sau 72h)
  // ─────────────────────────────────────────────────────────────────
  @Cron('0 * * * *') // Chạy mỗi giờ (vào phút 0)
  async handleAutoCompleteOldJobs() {
    this.logger.log('🧹 [Cron] Đang quét các đơn hàng bị treo quá 72h...');
    
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - 72);

    const staleSessions = await this.prisma.chatSession.findMany({
      where: {
        status: 'IN_PROGRESS',
        updatedAt: { lt: threshold },
      },
    });

    if (staleSessions.length > 0) {
      for (const session of staleSessions) {
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: { status: 'COMPLETED' },
        });
        this.logger.log(`✅ [Cron] Tự động đóng đơn #${session.id} (Treo > 72h)`);
      }
    }
  }

  async deleteUserSession(userId: number, sessionId: number) {
    try {
      // 1. Kiểm tra xem ca chẩn đoán này có đúng là của User này không
      const session = await this.prisma.chatSession.findFirst({
        where: { id: sessionId, userId: userId },
      });

      if (!session) {
        throw new NotFoundException('Dạ không tìm thấy ca chẩn đoán này ạ!');
      }

      // 2. Xóa các log liên quan trong bảng aiReasoningLog trước (Tránh lỗi khóa ngoại Foreign Key)
      await this.prisma.aiReasoningLog.deleteMany({
        where: { sessionId: sessionId },
      });

      // 3. Tiến hành xóa phiên chat chính
      await this.prisma.chatSession.delete({
        where: { id: sessionId },
      });

      return { success: true, message: 'Đã xóa ca chẩn đoán thành công.' };
    } catch (error) {
      this.logger.error(`Lỗi khi xóa session ${sessionId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Không thể xóa ca chẩn đoán.');
    }
  }

}
