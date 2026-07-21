/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prettier/prettier */
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Patch,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatsService } from './chats.service';
import { UploadService } from '../upload/upload.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { MessageType } from '@prisma/client';
import { ChatsGateway } from './chats.gateway';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';

@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly uploadService: UploadService,
    private readonly chatsGateway: ChatsGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // GET /chats
  // Lấy danh sách các phiên chat của user đang đăng nhập (Hộp thư)
  // ─────────────────────────────────────────────────────────────────
  @Get()
  @UseGuards(JwtAuthGuard)
  async getUserSessions(@Req() req) {
    const { userId, role } = getRequestUser(req);
    return this.chatsService.getAccessibleUserSessions(userId, role);
  }

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createChatSession(@Req() req, @Body() dto: CreateChatSessionDto) {
    const { userId } = getRequestUser(req);
    return this.chatsService.createChatSession(userId, dto);
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /chats/:id
  // Lấy chi tiết một phiên chat (bao gồm status hiện tại)
  // ─────────────────────────────────────────────────────────────────
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getSessionById(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const { userId, role } = getRequestUser(req);
    await this.chatsService.assertCanAccessSession(id, userId, role);
    const session = await this.chatsService.getSessionById(id);
    
    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat này.');
    }

    // Kiểm tra quyền truy cập: Chỉ khách hàng hoặc thợ của phiên này mới được xem
    // Hoặc cho phép thợ xem khi đơn đang phát sóng (BROADCASTING) để họ xem chi tiết trước khi nhận
    const normalizedRole = role?.toUpperCase();
    const isAdmin = normalizedRole === 'ADMIN';
    const isBroadcastToTech = normalizedRole === 'TECHNICIAN' && session.status === 'BROADCASTING';
    if (!isAdmin && session.userId !== userId && session.technicianId !== userId && !isBroadcastToTech) {
      throw new ForbiddenException('Bạn không có quyền truy cập thông tin phiên chat này.');
    }

    const aiMetadata = await this.chatsService.getLatestAiSessionMetadata(id);

    return {
      ...session,
      ...aiMetadata,
      bookingTriggered: session.status !== 'AI_CONSULTING',
    };
  }

  // --- API DÀNH CHO THỢ (TECHNICIAN ROLE) ---

  @UseGuards(JwtAuthGuard)
  @Get('technician/jobs/broadcast')
  async getBroadcastJobs(@Req() req) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.getBroadcastJobs(technicianId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('technician/jobs/:id/accept')
  async acceptJob(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
    @Body() body: { currentVersion: number },
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.acceptJob(id, technicianId, body.currentVersion);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/technician/jobs/:id/cancel
  // Thợ chủ động từ bỏ đơn hàng → Trả về BROADCASTING
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('technician/jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelJob(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.cancelJob(id, technicianId);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/technician/jobs/:id/complete
  // Thợ xác nhận hoàn thành đơn → Chuyển sang COMPLETED
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('technician/jobs/:id/complete')
  @HttpCode(HttpStatus.OK)
  async completeJob(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.completeJob(id, technicianId);
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /chats/:id/messages?cursor=10&limit=20
  // Lấy danh sách tin nhắn của phiên chat (Cursor-based Pagination)
  // ─────────────────────────────────────────────────────────────────
  @Get(':id/messages')
  @UseGuards(JwtAuthGuard)
  async getMessages(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Query('cursor') cursorRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const { userId, role } = getRequestUser(req);
    const cursor = cursorRaw ? parseInt(cursorRaw, 10) : undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;

    return this.chatsService.getMessagesForUser(
      sessionId,
      userId,
      role,
      cursor,
      limit,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/:id/messages
  // Gửi tin nhắn mới vào phiên chat
  // Tạm hardcode senderId = 3 (Khách hàng) để test
  // ─────────────────────────────────────────────────────────────────
  @Post(':id/messages')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Body() dto: SendMessageDto,
  ) {
    const { userId, role } = getRequestUser(req);
    return this.chatsService.processSessionMessage(
      sessionId,
      userId,
      dto,
      role,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/:id/quotes
  // Thợ tạo báo giá mới cho phiên chat
  // ─────────────────────────────────────────────────────────────────
  @Post(':id/quotes')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createQuote(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Body() dto: CreateQuoteDto,
  ) {
    const { userId, role } = getRequestUser(req);
    await this.chatsService.assertCanAccessSession(sessionId, userId, role);
    const technicianId = userId;
    return this.chatsService.createQuote(sessionId, technicianId, dto);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/:id/image
  // Upload ảnh/video vào phiên chat → Lưu lên R2 → Tạo tin nhắn
  // ─────────────────────────────────────────────────────────────────
  @Post(':id/image')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMediaMessage(
    @Param('id', ParseIntPipe) sessionId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('deviceType') deviceType: string,
    @Body('symptom') symptom: string,
    @Req() req,
  ) {
    const { userId, role } = getRequestUser(req);
    const deviceSwitchResult = await this.chatsService.detectDeviceSwitchForSession(
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

    if (!file) {
      throw new BadRequestException('Không tìm thấy file. Vui lòng chọn file để gửi.');
    }

    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/x-matroska'
    ];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Loại file không hỗ trợ (${file.mimetype}). Chỉ chấp nhận: Ảnh (JPEG, PNG, WebP, HEIC) và Video (MP4, MOV, MKV).`,
      );
    }

    const maxSize = file.mimetype.startsWith('video/')
      ? 50 * 1024 * 1024
      : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File quá lớn (${(file.size / 1024 / 1024).toFixed(1)}MB). Tối đa: 50MB.`,
      );
    }

    // Upload lên R2
    const fileUrl = await this.uploadService.uploadFile(file, 'chat-media');

    // Xác định MessageType dựa vào mimetype
    const type = file.mimetype.startsWith('video/') ? MessageType.VIDEO : MessageType.IMAGE;

    const message = await this.chatsService.processSessionMessage(sessionId, userId, {
      type: type,
      content: fileUrl,
      deviceType: deviceType || undefined,
      symptom: symptom || undefined,
      metadata: {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    }, role);

    return {
      message: 'Gửi file thành công!',
      fileUrl,
      data: message,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH /chats/messages/:messageId/quote
  // Cập nhật trạng thái báo giá và emit qua socket
  // ─────────────────────────────────────────────────────────────────
  @Patch('messages/:messageId/quote')
  @UseGuards(JwtAuthGuard)
  async updateQuoteStatus(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body('status') status: 'ACCEPTED' | 'REJECTED',
    @Req() req,
  ) {
    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Trạng thái không hợp lệ.');
    }

    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    const { message } = await this.chatsService.updateQuoteStatus(messageId, userId, status);

    // Emit event socket tới phòng chat
    const roomName = `room_${message.sessionId}`;
    this.chatsGateway.server.to(roomName).emit('quote_updated', {
      messageId: message.id,
      status: status,
      message: message, // Gửi luôn message mới nhất để frontend cập nhật
    });

    return {
      message: 'Đã cập nhật trạng thái báo giá thành công.',
      data: message,
    };
  }

  @Patch('messages/:messageId/read')
  @UseGuards(JwtAuthGuard)
  async markAsRead(@Param('messageId', ParseIntPipe) messageId: number, @Req() req) {
    const { userId, role } = getRequestUser(req);
    return this.chatsService.markMessageAsReadForUser(messageId, userId, role);
  }

  @Patch(':id/read-all')
  @UseGuards(JwtAuthGuard)
  async markAllAsRead(@Param('id', ParseIntPipe) sessionId: number, @Req() req) {
    const { userId, role } = getRequestUser(req);
    return this.chatsService.markAllAsReadForUser(sessionId, userId, role);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/:id/book
  // Khách hàng chốt đơn đặt thợ → Chuyển sang BROADCASTING
  // ─────────────────────────────────────────────────────────────────
  @Post(':id/book')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async bookTechnician(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Body() body: {
      contactName?: string;
      contactPhone?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const { userId, role } = getRequestUser(req);
    const session = await this.chatsService.bookTechnicianFromSession(
      sessionId,
      userId,
      role,
      body,
    );
    
    return {
      message: 'Đã chốt đơn thành công! Hệ thống đang phát sóng tìm thợ quanh khu vực của bạn.',
      data: session,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/user/jobs/:id/review
  // Khách hàng gửi đánh giá sau khi đơn COMPLETED
  // ─────────────────────────────────────────────────────────────────
  @Post('user/jobs/:id/review')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async submitReview(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
    @Body() body: { rating: number; comment?: string; tags?: string[] },
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.submitReview(sessionId, userId, body);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/technician/jobs/:id/start-moving
  // Thợ xác nhận bắt đầu di chuyển đến nhà khách
  // ─────────────────────────────────────────────────────────────────
  @Post('technician/jobs/:id/start-moving')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startEnRoute(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.startEnRoute(id, technicianId);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/technician/jobs/:id/start-repair
  // Thợ xác nhận bắt đầu sửa chữa → Chuyển sang IN_PROGRESS
  // ─────────────────────────────────────────────────────────────────
  @Post('technician/jobs/:id/start-repair')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startRepair(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    
    // Gọi sang ChatsService để xử lý logic đổi status và emit socket
    return this.chatsService.startRepair(id, technicianId);
  }

  @Post('technician/jobs/:id/arrived')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async confirmArrival(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.confirmArrival(id, technicianId);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/user/jobs/:id/cancel
  // Khách hàng chủ động hủy đơn
  // ─────────────────────────────────────────────────────────────────
  @Post('user/jobs/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async userCancelJob(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.cancelJob(id, userId);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /chats/user/jobs/:id/redispatch
  // Khách hàng yêu cầu tìm thợ khác (Trị Ghosting)
  // ─────────────────────────────────────────────────────────────────
  @Post('user/jobs/:id/redispatch')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async redispatchJob(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.redispatchJob(id, userId);
  }

  // ─────────────────────────────────────────────────────────────────
  // DELETE /chats/sessions/bulk  ← PHẢI ĐẶT TRƯỚC :id
  // Xóa hàng loạt nhiều phiên AI theo danh sách ID
  // Flutter gọi: PATCH /chats/sessions/hide-bulk → map sang route này
  // ─────────────────────────────────────────────────────────────────
  @Delete('sessions/bulk')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteBulkSessions(
    @Body('ids') ids: number[],
    @Req() req,
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.deleteBulkUserSessions(userId, ids);
  }

  // Alias PATCH hide-bulk → gọi cùng service (tương thích Flutter)
  @Patch('sessions/hide-bulk')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async hideBulkSessions(
    @Body('ids') ids: number[],
    @Req() req,
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.deleteBulkUserSessions(userId, ids);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteUserSession(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
  ) {
    const { userId, role } = getRequestUser(req);
    return this.chatsService.deleteUserSessionSecure(userId, sessionId, role);
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /chats/active/running
  // Lấy danh sách các đơn đang hoạt động
  // ─────────────────────────────────────────────────────────────────
  @Get('active/running')
  @UseGuards(JwtAuthGuard)
  async getActiveRunningSessions(@Req() req) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.getActiveRunningSessions(userId);
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /chats/user/history
  // Lấy lịch sử sửa chữa của khách hàng
  // ─────────────────────────────────────────────────────────────────
  @Get('user/history')
  @UseGuards(JwtAuthGuard)
  async getUserRepairHistory(@Req() req) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.getUserRepairHistory(userId);
  }
}

function getRequestUser(req: any) {
  return {
    userId: Number(req.user?.id || req.user?.userId || req.user?.sub),
    role: req.user?.role as string | undefined,
  };
}

