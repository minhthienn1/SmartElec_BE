import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminReviewsService } from './admin-reviews.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly adminReviewsService: AdminReviewsService) {}

  /** Trả về danh sách đánh giá để admin theo dõi và lọc trên toàn hệ thống. */
  @Get()
  getReviews(
    @Query('search') search?: string,
    @Query('rating') rating?: string,
    @Query('sentiment') sentiment?: string,
    @Query('tag') tag?: string,
    @Query('technicianId') technicianId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.adminReviewsService.getReviews({
      search,
      rating,
      sentiment,
      tag,
      technicianId,
      customerId,
    });
  }
}
