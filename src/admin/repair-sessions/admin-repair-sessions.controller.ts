import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRepairSessionsService } from './admin-repair-sessions.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/repair-sessions')
export class AdminRepairSessionsController {
  constructor(
    private readonly adminRepairSessionsService: AdminRepairSessionsService,
  ) {}

  /** Lấy danh sách resource repair session riêng cho giao diện admin vận hành. */
  @Get()
  getRepairSessions() {
    return this.adminRepairSessionsService.getRepairSessions();
  }

  /** Gán kỹ thuật viên cho một repair session từ resource admin riêng. */
  @Post(':id/assign')
  async assignTechnician(
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() body: { technicianId: number },
  ) {
    const session = await this.adminRepairSessionsService.assignTechnician(
      sessionId,
      Number(body.technicianId),
    );

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca sửa chữa.');
    }

    return session;
  }

  /** Gỡ kỹ thuật viên khỏi repair session và mở lại luồng điều phối. */
  @Post(':id/unassign')
  async unassignTechnician(@Param('id', ParseIntPipe) sessionId: number) {
    const session =
      await this.adminRepairSessionsService.unassignTechnician(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca sửa chữa.');
    }

    return session;
  }

  /** Hủy repair session từ góc nhìn quản trị vận hành. */
  @Post(':id/cancel')
  async cancelRepairSession(@Param('id', ParseIntPipe) sessionId: number) {
    const session =
      await this.adminRepairSessionsService.cancelRepairSession(sessionId);

    if (!session) {
      throw new NotFoundException('Không tìm thấy ca sửa chữa.');
    }

    return session;
  }
}
