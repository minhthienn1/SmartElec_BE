import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminAiReasoningLogsService } from './admin-ai-reasoning-logs.service';

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
}
