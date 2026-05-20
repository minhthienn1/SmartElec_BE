import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { RagService } from './rag.service';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Bật JwtAuthGuard để bảo vệ API, chỉ Admin hoặc người có quyền mới được nạp tài liệu
// Tạm thời để chung, sau này có thể thêm RolesGuard để chặn riêng Role = ADMIN
@UseGuards(JwtAuthGuard)
@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('ingest')
  async ingestDocument(@Body() dto: IngestDocumentDto) {
    return this.ragService.ingestDocument(dto);
  }

  @Get('documents')
  async getAllDocuments() {
    return this.ragService.getAllDocuments();
  }
}
