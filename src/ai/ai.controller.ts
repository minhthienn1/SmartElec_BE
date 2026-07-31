import { Controller, Post, Patch, Get, Delete, Body, Param, ParseIntPipe, UseGuards, Req, Logger, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) { }

  // ─────────────────────────────────────────────────────────────────
  // POST /ai/chat  — Dành cho KHÁCH HÀNG (SmartElec Buddy)
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ ai_chat: { limit: 1, ttl: 3000 } })
  @Post('chat')
  async chat(
    @Req() req,
    @Body() body: { message: string; sessionId?: string | number; image?: string; history?: any[] }
  ) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      this.logger.error(`Lỗi JWT: ${JSON.stringify(req.user)}`);
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }

    const sessionIdParam = body.sessionId ? Number(body.sessionId) : null;

    return this.aiService.chatWithAI(
      userId,
      body.message,
      sessionIdParam,
      body.image,
      body.history || []
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:sessionId/rating')
  async rateAiSession(
    @Req() req,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { rating: number; comment?: string },
  ) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }
    if (typeof body.rating !== 'number' || body.rating < 1 || body.rating > 5) {
      throw new BadRequestException('rating phải là số nguyên từ 1 đến 5.');
    }
    return this.aiService.rateAiSession(userId, sessionId, body.rating, body.comment);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /ai/tech-chat  — Dành riêng cho THỢ KỸ THUẬT (SmartElec Pro)
  // Prompt ADVANCED, RAG không giới hạn, không có booking flow
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ ai_chat: { limit: 1, ttl: 3000 } })
  @Post('tech-chat')
  async techChat(
    @Req() req,
    @Body() body: { message: string; image?: string; history?: any[]; techSessionKey?: string }
  ) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      this.logger.error(`[Tech] Lỗi JWT: ${JSON.stringify(req.user)}`);
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }

    if (!body.message || body.message.trim() === '') {
      throw new BadRequestException('Vui lòng nhập câu hỏi kỹ thuật.');
    }

    return this.aiService.chatWithAI_Tech(
      userId,
      body.message,
      body.image,
      body.history || [],
      body.techSessionKey,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /ai/tech-history — Lấy lịch sử chat AI của THỢ
  // (Trước đây thiếu route này nên app luôn trả về danh sách rỗng)
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('tech-history')
  async getTechHistory(@Req() req) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }
    return this.aiService.getTechHistory(userId);
  }

  // ─────────────────────────────────────────────────────────────────
  // DELETE /ai/tech-history/:id — Xóa 1 mục lịch sử chat AI của THỢ
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Delete('tech-history/:id')
  async deleteTechHistory(@Req() req, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }
    return this.aiService.deleteTechHistory(userId, id);
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /ai/tech-history/:id/rate — Đánh giá sao 1 mục lịch sử
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('tech-history/:id/rate')
  async rateTechHistory(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { score: number; comment?: string },
  ) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      throw new BadRequestException('Lỗi xác thực: Không tìm thấy ID người dùng.');
    }
    if (typeof body.score !== 'number' || body.score < 1 || body.score > 5) {
      throw new BadRequestException('score phải là số từ 1 đến 5.');
    }
    return this.aiService.rateTechHistory(userId, id, body.score, body.comment);
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH /ai/messages/:logId/feedback
  // Lưu Like/Dislike vào AiReasoningLog (RLHF)
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch('messages/:logId/feedback')
  async saveFeedback(
    @Param('logId', ParseIntPipe) logId: number,
    @Body('feedback') feedback: string,
  ) {
    if (!['LIKE', 'DISLIKE'].includes(feedback)) {
      throw new BadRequestException('feedback phải là "LIKE" hoặc "DISLIKE".');
    }
    return this.aiService.saveFeedback(logId, feedback as 'LIKE' | 'DISLIKE');
  }
}
