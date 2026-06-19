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
    const userId = Number(req.user.id || req.user.userId || req.user.sub); 
    return this.chatsService.getUserSessions(userId);
  }

  @Get('active/running')
  @UseGuards(JwtAuthGuard)
  async getActiveSessions(@Req() req) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.getActiveSessions(userId);
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /chats/:id
  // Lấy chi tiết một phiên chat (bao gồm status hiện tại)
  // ─────────────────────────────────────────────────────────────────
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getSessionById(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    const session = await this.chatsService.getSessionById(id);
    
    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat này.');
    }

    // Kiểm tra quyền truy cập: Chỉ khách hàng hoặc thợ của phiên này mới được xem
    // Hoặc cho phép thợ xem khi đơn đang phát sóng (BROADCASTING) để họ xem chi tiết trước khi nhận
    const isBroadcastToTech = req.user.role === 'TECHNICIAN' && session.status === 'BROADCASTING';
    if (session.userId !== userId && session.technicianId !== userId && !isBroadcastToTech) {
      throw new ForbiddenException('Bạn không có quyền truy cập thông tin phiên chat này.');
    }

    return session;
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
  async getMessages(
    @Param('id', ParseIntPipe) sessionId: number,
    @Query('cursor') cursorRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const cursor = cursorRaw ? parseInt(cursorRaw, 10) : undefined;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;

    return this.chatsService.getMessages(sessionId, cursor, limit);
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
    const senderId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.sendMessage(sessionId, senderId, dto);
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
    const technicianId = Number(req.user.id || req.user.userId || req.user.sub);
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
    @Req() req,
  ) {
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

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File quá lớn (${(file.size / 1024 / 1024).toFixed(1)}MB). Tối đa: 50MB.`,
      );
    }

    // Upload lên R2
    const fileUrl = await this.uploadService.uploadFile(file, 'chat-media');

    // Xác định MessageType dựa vào mimetype
    const type = file.mimetype.startsWith('video/') ? MessageType.VIDEO : MessageType.IMAGE;

    const senderId = Number(req.user.id || req.user.userId || req.user.sub);
    const message = await this.chatsService.sendMessage(sessionId, senderId, {
      type: type,
      content: fileUrl,
      metadata: {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      },
    });

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
  async markAsRead(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.chatsService.markAsRead(messageId);
  }

  @Patch(':id/read-all')
  @UseGuards(JwtAuthGuard)
  async markAllAsRead(@Param('id', ParseIntPipe) sessionId: number, @Req() req) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    return this.chatsService.markAllAsRead(sessionId, userId);
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
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    const session = await this.chatsService.bookTechnician(sessionId, userId, body);
    
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

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteUserSession(
    @Param('id', ParseIntPipe) sessionId: number,
    @Req() req,
  ) {
    const userId = Number(req.user.id || req.user.userId || req.user.sub);
    
    // Gọi sang hàm deleteUserSession ở chats.service.ts mà bạn vừa thêm
    return this.chatsService.deleteUserSession(userId, sessionId);
  }
}

