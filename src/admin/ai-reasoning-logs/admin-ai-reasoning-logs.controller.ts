import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAiReasoningLogsService } from './admin-ai-reasoning-logs.service';
import { UpdateAiUsefulnessReviewDto } from './dto/update-ai-usefulness-review.dto';

@UseGuards(JwtAuthGuard)
@Controller('admin/ai-reasoning-logs')
export class AdminAiReasoningLogsController {
  constructor(
    private readonly adminAiReasoningLogsService: AdminAiReasoningLogsService,
  ) {}

  /** Trả về danh sách log suy luận AI để admin theo dõi chất lượng câu trả lời. */
  @Get()
  getLogs(
    @Query('search') search?: string,
    @Query('feedback') feedback?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('deviceCategory') deviceCategory?: string,
    @Query('scoreLevel') scoreLevel?: string,
    @Query('golden') golden?: string,
  ) {
    return this.adminAiReasoningLogsService.getLogs({
      search,
      feedback,
      riskLevel,
      deviceCategory,
      scoreLevel,
      golden,
    });
  }

  @Get(':id/retrieved-chunks')
  getRetrievedChunks(@Param('id', ParseIntPipe) id: number) {
    return this.adminAiReasoningLogsService.getRetrievedChunks(id);
  }

  @Patch(':id/usefulness-review')
  updateUsefulnessReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpdateAiUsefulnessReviewDto,
    @Req() req: { user?: { id?: number; userId?: number; sub?: number } },
  ) {
    const reviewerId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    if (!Number.isInteger(reviewerId) || reviewerId <= 0) {
      throw new BadRequestException('Khong xac dinh duoc tai khoan quan tri vien');
    }

    return this.adminAiReasoningLogsService.updateUsefulnessReview(
      id,
      reviewerId,
      payload,
    );
  }
}
