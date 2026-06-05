import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminQuotesService } from './admin-quotes.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/quotes')
export class AdminQuotesController {
  constructor(private readonly adminQuotesService: AdminQuotesService) {}

  /** Lấy danh sách báo giá cho màn admin với đầy đủ bộ lọc nghiệp vụ hiện có ở FE. */
  @Get()
  getQuotes(
    @Query('keyword') keyword?: string,
    @Query('status') status?: 'PENDING' | 'ACCEPTED' | 'REJECTED',
    @Query('address') address?: string,
    @Query('technicianName') technicianName?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('isOverdue') isOverdue?: string,
    @Query('isMismatch') isMismatch?: string,
  ) {
    return this.adminQuotesService.getQuotes({
      keyword,
      status,
      address,
      technicianName,
      minAmount,
      maxAmount,
      isOverdue,
      isMismatch,
    });
  }
}
