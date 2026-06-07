import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { AdminRagKnowledgeService } from './admin-rag-knowledge.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/rag-knowledge')
export class AdminRagKnowledgeController {
  constructor(
    private readonly adminRagKnowledgeService: AdminRagKnowledgeService,
  ) {}

  @Get('documents')
  getDocuments() {
    return this.adminRagKnowledgeService.getDocuments();
  }

  @Post('documents')
  createDocument(@Body() dto: IngestDocumentDto) {
    return this.adminRagKnowledgeService.createDocument(dto);
  }

  @Patch('documents/:id')
  updateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: IngestDocumentDto,
  ) {
    return this.adminRagKnowledgeService.updateDocument(id, dto);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id', ParseIntPipe) id: number) {
    return this.adminRagKnowledgeService.deleteDocument(id);
  }
}
