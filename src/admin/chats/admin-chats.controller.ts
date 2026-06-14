import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminChatsService } from './admin-chats.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/chats')
export class AdminChatsController {
  constructor(private readonly adminChatsService: AdminChatsService) {}

  @Get()
  getChats(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('address') address?: string,
    @Query('technicianName') technicianName?: string,
    @Query('isDangerous') isDangerous?: string,
  ) {
    return this.adminChatsService.getChats({
      keyword,
      status,
      address,
      technicianName,
      isDangerous,
    });
  }

  @Get(':id')
  async getChatById(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminChatsService.getChatById(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }

  /** Gán thợ cho một ca chat cụ thể từ giao diện admin điều phối. */
  @Post(':id/assign')
  async assignTechnician(
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() body: { technicianId: number },
  ) {
    const session = await this.adminChatsService.assignTechnician(
      sessionId,
      Number(body.technicianId),
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }

  /** Gỡ thợ khỏi ca chat và đưa ca về hàng chờ phát lại. */
  @Post(':id/unassign')
  async unassignTechnician(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminChatsService.unassignTechnician(
      sessionId,
      'UNASSIGNED',
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }

  /** Đánh dấu thợ từ chối ca để dispatch có thể chuyển tiếp cho người khác. */
  @Post(':id/reject')
  async rejectTechnician(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminChatsService.unassignTechnician(
      sessionId,
      'REJECTED',
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }

  /** Mô phỏng timeout phản hồi của thợ để trả ca về hàng chờ broadcast. */
  @Post(':id/timeout')
  async timeoutTechnician(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminChatsService.unassignTechnician(
      sessionId,
      'SYSTEM_AUTO_CANCEL',
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }

  /** Hủy ca chat từ phía admin khi cần dừng hẳn luồng điều phối hoặc sửa chữa. */
  @Post(':id/cancel')
  async cancelChat(@Param('id', ParseIntPipe) sessionId: number) {
    const session = await this.adminChatsService.cancelChat(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy phiên chat.');
    }

    return session;
  }
}
