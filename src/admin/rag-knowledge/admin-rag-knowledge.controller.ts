import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ArchiveRagDocumentDto } from '../../rag/dto/archive-rag-document.dto';
import { ImportRagFileDto } from '../../rag/dto/import-rag-file.dto';
import { IngestDocumentDto } from '../../rag/dto/ingest-document.dto';
import { RagDocumentChunksQueryDto } from '../../rag/dto/rag-document-chunks-query.dto';
import {
  ALLOWED_RAG_IMPORT_EXTENSIONS,
  ALLOWED_RAG_IMPORT_MIME_TYPES,
  RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE,
  RAG_LIMITS,
} from '../../rag/rag.constants';
import { AdminRagKnowledgeService } from './admin-rag-knowledge.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/rag-knowledge')
export class AdminRagKnowledgeController {
  constructor(
    private readonly adminRagKnowledgeService: AdminRagKnowledgeService,
  ) {}

  @Get('stats')
  getStats() {
    return this.adminRagKnowledgeService.getStats();
  }

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
      limits: { fileSize: RAG_LIMITS.MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        const extension = extname(file.originalname || '').toLowerCase();
        const mimeType = (file.mimetype || '').toLowerCase();

        if (
          ALLOWED_RAG_IMPORT_EXTENSIONS.has(extension) &&
          ALLOWED_RAG_IMPORT_MIME_TYPES.has(mimeType)
        ) {
          callback(null, true);
          return;
        }

        callback(
          new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE),
          false,
        );
      },
    }),
  )
  importDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportRagFileDto,
    @Req() req: { user?: { id?: number; userId?: number; sub?: number } },
  ) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file để import.');
    }

    const originalFileName = file.originalname?.trim() || '';

    if (!originalFileName) {
      throw new BadRequestException('Tên file import không hợp lệ.');
    }

    if (originalFileName.length > RAG_LIMITS.MAX_FILENAME_CHARS) {
      throw new BadRequestException(
        `Tên file quá dài. Tối đa cho phép: ${RAG_LIMITS.MAX_FILENAME_CHARS} ký tự.`,
      );
    }

    if (file.size <= 0) {
      throw new BadRequestException('File import đang rỗng.');
    }

    if (file.size > RAG_LIMITS.MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File quá lớn. Tối đa cho phép: 50MB.');
    }

    const extension = extname(originalFileName).toLowerCase();
    if (!ALLOWED_RAG_IMPORT_EXTENSIONS.has(extension)) {
      throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
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
