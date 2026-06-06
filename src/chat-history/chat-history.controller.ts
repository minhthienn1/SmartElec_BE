import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ChatHistoryService } from './chat-history.service';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsInt, ArrayNotEmpty } from 'class-validator';

// DTO để validate request body
class SaveHistoryDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  summary: string;
}

class HideBulkDto {
  @IsArray({ message: 'Danh sách ID phải là một mảng' })
  @ArrayNotEmpty({ message: 'Mảng ID không được để trống' })
  @IsInt({ each: true, message: 'Mỗi ID trong mảng phải là số nguyên' })
  ids: number[];
}

@Controller('chats')
@UseGuards(AuthGuard('jwt')) 
export class ChatHistoryController {
  constructor(private readonly chatHistoryService: ChatHistoryService) {}

  /**
   * POST /chats/save
   * Lưu một phiên chẩn đoán mới.
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
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getHistory(@Req() req: { user: { userId: number } }) {
    const userId = req.user.userId;
    return this.chatHistoryService.getUserHistory(userId);
  }

  /**
   * PATCH /chats/sessions/:id/hide
   * Ẩn (xóa mềm) một phiên chẩn đoán của user.
   */
  @Patch('sessions/:id/hide')
  @HttpCode(HttpStatus.OK)
  async hideSession(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: { userId: number } },
  ) {
    console.log(`--- [API HITTING] PATCH /chats/sessions/${id}/hide ---`);
    const userId = req.user.userId;
    return this.chatHistoryService.hideChatSession(id, userId);
  }

  /**
   * PATCH /chats/sessions/hide-bulk
   * Ẩn (xóa mềm) NHIỀU phiên chẩn đoán cùng lúc.
   */
  @Patch('sessions/hide-bulk')
  @HttpCode(HttpStatus.OK)
  async hideBulkSessions(
    @Req() req: { user: { userId: number } },
    @Body() body: HideBulkDto, // Validate mảng IDs tự động
  ) {
    console.log(`--- [API HITTING] PATCH /chats/sessions/hide-bulk ---`);
    console.log(`Đang yêu cầu ẩn các IDs:`, body.ids);
    
    const userId = req.user.userId;
    // Gọi sang service
    return this.chatHistoryService.hideMultipleChatSessions(body.ids, userId);
  }
}