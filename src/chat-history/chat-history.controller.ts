import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatHistoryService } from './chat-history.service';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

// DTO để validate request body
class SaveHistoryDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  summary: string;
}

@Controller('chats')
@UseGuards(AuthGuard('jwt')) // Dùng AuthGuard('jwt') thay vì import guard trực tiếp → linh hoạt hơn
export class ChatHistoryController {
  constructor(private readonly chatHistoryService: ChatHistoryService) {}

  /**
   * POST /chats/save
   * Lưu một phiên chẩn đoán mới.
   * Body: { title: string, summary: string }
   * userId được lấy tự động từ JWT token (req.user.userId)
   */
  @Post('save')
  @HttpCode(HttpStatus.CREATED)
  async saveHistory(
    @Req() req: { user: { userId: number } },
    @Body() body: SaveHistoryDto,
  ) {
    console.log('--- [API HITTING] POST /chats/save ---');
    console.log('Body:', body);
    console.log('User ID từ Token:', req.user.userId);

    // Validate body (Nếu gửi lên chuỗi rỗng thì vẫn chấp nhận, chỉ chặn undefined)
    if (body.title === undefined || body.summary === undefined) {
      console.log('❌ LỖI: Thiếu title hoặc summary trong payload gửi lên.');
      throw new BadRequestException('Thiếu trường bắt buộc: title, summary');
    }

    const userId = req.user.userId;
    return this.chatHistoryService.saveSession(userId, body.title, body.summary);
  }

  /**
   * GET /chats/history
   * Trả về toàn bộ lịch sử chẩn đoán của user đang đăng nhập.
   * userId được lấy tự động từ JWT token (req.user.userId)
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getHistory(@Req() req: { user: { userId: number } }) {
    const userId = req.user.userId;
    return this.chatHistoryService.getUserHistory(userId);
  }
}