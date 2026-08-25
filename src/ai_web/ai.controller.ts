import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';

@Controller('ai-web')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {
    // Nhận AiService để chuyển các request HTTP sang luồng xử lý AI dành riêng cho website.
  }

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
    },
  ) {
    // Xác thực user từ JWT, chuẩn hóa sessionId rồi chuyển message và lịch sử sang orchestrator AI web.
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
      throw new BadRequestException(
        'Lỗi xác thực: Không tìm thấy ID người dùng.',
      );
    }

    if (
      typeof body.rating !== 'number' ||
      !Number.isInteger(body.rating) ||
      body.rating < 1 ||
      body.rating > 5
    ) {
      throw new BadRequestException('rating phải là số nguyên từ 1 đến 5.');
    }

    return this.aiService.rateAiSession(
      userId,
      sessionId,
      body.rating,
      body.comment,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:logId/feedback')
  async saveFeedback(
    @Param('logId', ParseIntPipe) logId: number,
    @Body('feedback') feedback: string,
  ) {
    // Chỉ chấp nhận LIKE/DISLIKE trước khi lưu phản hồi cho reasoning log tương ứng.
    if (!['LIKE', 'DISLIKE'].includes(feedback)) {
      throw new BadRequestException(
        'feedback phải là "LIKE" hoặc "DISLIKE".',
      );
    }

    return this.aiService.saveFeedback(logId, feedback as 'LIKE' | 'DISLIKE');
  }
}
