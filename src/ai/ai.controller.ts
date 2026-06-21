import { Controller, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req, Logger, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  
  constructor(private readonly aiService: AiService) {}

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

    // Chuyển đổi sessionId sang kiểu số (number), nếu không có hoặc truyền lên null/undefined thì để là null
    const sessionIdParam = body.sessionId ? Number(body.sessionId) : null;

    // ĐƯA sessionIdParam VÀO VỊ TRÍ THỨ 3 (Đúng thứ tự hàm chatWithAI mới sửa ở ai.service.ts)
    return this.aiService.chatWithAI(
      userId, 
      body.message, 
      sessionIdParam, 
      body.image, 
      body.history || []
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
