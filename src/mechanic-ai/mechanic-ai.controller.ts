import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { MechanicAiService } from './mechanic-ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// @UseGuards(JwtAuthGuard) // Có thể bật lên để chặn người ngoài gọi API nạp tài liệu
@Controller('mechanic-ai')
export class MechanicAiController {
  constructor(private readonly mechanicAiService: MechanicAiService) {}

  // 3. Tạo Controller Endpoint
  @Post('ingest')
  async ingestDocument(
    @Body('title') title: string,
    @Body('content') content: string,
    @Body('category') category?: string,
    @Body('source') source?: string,
    @Body('accessLevel') accessLevel?: 'BASIC' | 'ADVANCED',
  ) {
    return this.mechanicAiService.ingestDocument(title, content, category, source, accessLevel);
  }

  // 4. API Search (Retrieval)
  @Get('search')
  async searchDocument(
    @Query('q') query: string,
    @Query('level') level?: 'BASIC' | 'ADVANCED',
    @Query('limit') limit?: string,
  ) {
    const accessLevel = level || 'BASIC';
    const limitNum = limit ? parseInt(limit, 10) : 3;
    return this.mechanicAiService.findRelevantDocs(query, accessLevel, limitNum);
  }
}
