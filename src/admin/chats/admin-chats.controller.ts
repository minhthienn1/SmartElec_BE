import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
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
}
