import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  /** Lấy snapshot dashboard riêng cho admin thay vì để FE tự tổng hợp nhiều nguồn. */
  @Get()
  getDashboardData() {
    return this.adminDashboardService.getDashboardData();
  }
}
