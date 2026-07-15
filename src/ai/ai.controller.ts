import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  // ─────────────────────────────────────────────────────────────────
  // POST /ai/chat  — Dành cho KHÁCH HÀNG (SmartElec Buddy)
  // ─────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ ai_chat: { limit: 1, ttl: 3000 } })
  @Post('chat')
  async chat(
    @Req() req,
    @Body()
    body: {
      message: string;
      sessionId?: string | number;
      image?: string;
      history?: any[];
      state?: Record<string, any> | null;
    },
  ) {
    const userId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!userId || isNaN(userId)) {
      this.logger.error(`Lỗi JWT: ${JSON.stringify(req.user)}`);
      throw new BadRequestException(
        'Lỗi xác thực: Không tìm thấy ID người dùng.',
      );
    }

    const sessionIdParam = body.sessionId ? Number(body.sessionId) : null;

    return this.aiService.chatWithAI(
      userId,
      body.message,
      sessionIdParam,
      body.image,
      body.history || [],
      body.state || null,
    );
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
    @Body() body: { message: string; image?: string; history?: any[] }
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
    );
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
