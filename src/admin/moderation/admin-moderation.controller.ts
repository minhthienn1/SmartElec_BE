import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminModerationService } from './admin-moderation.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(
    private readonly adminModerationService: AdminModerationService,
  ) {}

  /** Lấy hàng đợi moderation tổng hợp cho màn quản trị kiểm duyệt. */
  @Get()
  getModerationQueue() {
    return this.adminModerationService.getModerationQueue();
  }
}
