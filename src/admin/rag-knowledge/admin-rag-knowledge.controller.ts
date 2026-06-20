import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ArchiveRagDocumentDto } from '../../rag/dto/archive-rag-document.dto';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { ImportRagFileDto } from '../../rag/dto/import-rag-file.dto';
import { RagDocumentChunksQueryDto } from '../../rag/dto/rag-document-chunks-query.dto';
import { AdminRagKnowledgeService } from './admin-rag-knowledge.service';

const MAX_RAG_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_RAG_IMPORT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.docx',
  '.xlsx',
  '.pdf',
]);

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

  @Get('documents/:id/chunks')
  getDocumentChunks(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RagDocumentChunksQueryDto,
  ) {
    return this.adminRagKnowledgeService.getDocumentChunks(id, query);
  }

  @Get('documents/:id')
  getDocumentDetail(@Param('id', ParseIntPipe) id: number) {
    return this.adminRagKnowledgeService.getDocumentDetail(id);
  }

  @Get('chunks/:chunkId')
  getChunkDetail(@Param('chunkId', ParseIntPipe) chunkId: number) {
    return this.adminRagKnowledgeService.getChunkDetail(chunkId);
  }

  @Post('documents')
  createDocument(@Body() dto: IngestDocumentDto) {
    return this.adminRagKnowledgeService.createDocument(dto);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_RAG_FILE_SIZE_BYTES },
    }),
  )
  importDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportRagFileDto,
    @Req() req: { user?: { id?: number; userId?: number; sub?: number } },
  ) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file để import');
    }

    if (file.size > MAX_RAG_FILE_SIZE_BYTES) {
      throw new BadRequestException('File quá lớn. Tối đa cho phép: 10MB.');
    }

    const extension = extname(file.originalname).toLowerCase();
    if (!ALLOWED_RAG_IMPORT_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Chi ho tro file TXT, MD, CSV, DOCX, XLSX hoac PDF text.',
      );
    }

    const uploadedById = Number(
      req.user?.id || req.user?.userId || req.user?.sub,
    );

    return this.adminRagKnowledgeService.importDocumentFile(
      file,
      dto,
      Number.isFinite(uploadedById) ? uploadedById : undefined,
    );
  }

  @Patch('documents/:id')
  updateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: IngestDocumentDto,
  ) {
    return this.adminRagKnowledgeService.updateDocument(id, dto);
  }

  @Patch('documents/:id/archive')
  archiveDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveRagDocumentDto,
  ) {
    return this.adminRagKnowledgeService.archiveDocument(id, dto);
  }

  @Post('documents/:id/reindex')
  reindexDocument(@Param('id', ParseIntPipe) id: number) {
    return this.adminRagKnowledgeService.reindexDocument(id);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id', ParseIntPipe) id: number) {
    return this.adminRagKnowledgeService.deleteDocument(id);
  }
}
