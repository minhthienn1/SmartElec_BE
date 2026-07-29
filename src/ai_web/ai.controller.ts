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

  constructor(private readonly aiService: AiService) {}

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
  @Patch('messages/:logId/feedback')
  async saveFeedback(
    @Param('logId', ParseIntPipe) logId: number,
    @Body('feedback') feedback: string,
  ) {
    if (!['LIKE', 'DISLIKE'].includes(feedback)) {
      throw new BadRequestException(
        'feedback phải là "LIKE" hoặc "DISLIKE".',
      );
    }

    return this.aiService.saveFeedback(logId, feedback as 'LIKE' | 'DISLIKE');
  }
}
