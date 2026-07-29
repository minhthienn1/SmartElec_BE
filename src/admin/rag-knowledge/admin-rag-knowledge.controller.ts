import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  Logger,
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
import { UpdateRagDocumentDto } from '../../rag/dto/update-rag-document.dto';
import { RagDocumentChunksQueryDto } from '../../rag/dto/rag-document-chunks-query.dto';
import { ImportRagConversationDto } from './dto/import-rag-conversation.dto';
import {
  ALLOWED_RAG_IMPORT_EXTENSIONS,
  ALLOWED_RAG_IMPORT_MIME_TYPES,
  RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE,
  RAG_LIMITS,
} from '../../rag/rag.constants';
import { AdminRagKnowledgeService } from './admin-rag-knowledge.service';

type AuthenticatedRequest = {
  user?: {
    id?: number;
    userId?: number;
    sub?: number;
  };
};

const SUGGEST_METADATA_MAX_FILE_SIZE_BYTES = Math.min(
  RAG_LIMITS.MAX_FILE_SIZE_BYTES,
  10 * 1024 * 1024,
);

const RAG_FILE_FILTER = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (isAllowedRagFile(file)) {
    callback(null, true);
    return;
  }

  callback(new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE), false);
};

@UseGuards(JwtAuthGuard)
@Controller('admin/rag-knowledge')
export class AdminRagKnowledgeController {
  private readonly logger = new Logger(AdminRagKnowledgeController.name);

  constructor(
    private readonly adminRagKnowledgeService: AdminRagKnowledgeService,
  ) { }

  @Get('stats')
  getStats() {
    return this.adminRagKnowledgeService.getStats();
  }

  @Get('documents')
  getDocuments() {
    return this.adminRagKnowledgeService.getDocuments();
  }

  @Get('conversation-candidates')
  getConversationCandidates(
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    return this.adminRagKnowledgeService.getConversationCandidates({
      type,
      search,
    });
  }

  @Post('import-conversation')
  importConversation(@Body() dto: ImportRagConversationDto) {
    return this.adminRagKnowledgeService.importConversationCandidate(dto);
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

  @Post('suggest-metadata')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: SUGGEST_METADATA_MAX_FILE_SIZE_BYTES,
      },
      fileFilter: RAG_FILE_FILTER,
    }),
  )
  async suggestImportMetadata(@UploadedFile() file: Express.Multer.File) {
    this.validateUploadedRagFile(file, {
      mode: 'suggest',
      maxFileSizeBytes: SUGGEST_METADATA_MAX_FILE_SIZE_BYTES,
    });

    try {
      return await this.adminRagKnowledgeService.suggestImportMetadata(file);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Không thể đọc file để gợi ý metadata: ${file?.originalname || 'unknown'}`,
        error instanceof Error ? error.stack : String(error),
      );

      throw new InternalServerErrorException(
        'Không thể đọc file để gợi ý metadata. Bạn vẫn có thể nhập thông tin thủ công rồi import.',
      );
    }
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: RAG_LIMITS.MAX_FILE_SIZE_BYTES,
      },
      fileFilter: RAG_FILE_FILTER,
    }),
  )
  async importDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportRagFileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateUploadedRagFile(file, {
      mode: 'import',
      maxFileSizeBytes: RAG_LIMITS.MAX_FILE_SIZE_BYTES,
    });

    const uploadedById = Number(
      req.user?.id || req.user?.userId || req.user?.sub,
    );

    try {
      return await this.adminRagKnowledgeService.importDocumentFile(
        file,
        dto,
        Number.isFinite(uploadedById) ? uploadedById : undefined,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Không thể import tài liệu RAG: ${file?.originalname || 'unknown'}`,
        error instanceof Error ? error.stack : String(error),
      );

      throw new InternalServerErrorException(
        'Không thể import tài liệu RAG. Vui lòng thử lại sau.',
      );
    }
  }

  @Patch('documents/:id')
  updateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRagDocumentDto,
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

  private validateUploadedRagFile(
    file: Express.Multer.File | undefined,
    options: {
      mode: 'suggest' | 'import';
      maxFileSizeBytes: number;
    },
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException(
        options.mode === 'suggest'
          ? 'Không tìm thấy file để đọc gợi ý.'
          : 'Không tìm thấy file để import.',
      );
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

    if (file.size > options.maxFileSizeBytes) {
      throw new BadRequestException(
        options.mode === 'suggest'
          ? 'File quá lớn để đọc gợi ý. Vui lòng nhập metadata thủ công hoặc dùng file nhỏ hơn 10MB.'
          : 'File quá lớn. Vui lòng chọn file nhỏ hơn giới hạn cho phép.',
      );
    }

    const extension = extname(originalFileName).toLowerCase();

    if (!ALLOWED_RAG_IMPORT_EXTENSIONS.has(extension)) {
      throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
    }
  }
}

function isAllowedRagFile(file: Express.Multer.File): boolean {
  const extension = extname(file.originalname || '').toLowerCase();
  const mimeType = (file.mimetype || '').toLowerCase();

  const hasAllowedExtension = ALLOWED_RAG_IMPORT_EXTENSIONS.has(extension);

  const hasAllowedMimeType =
    ALLOWED_RAG_IMPORT_MIME_TYPES.has(mimeType) ||
    mimeType === 'application/octet-stream' ||
    mimeType === '';

  return hasAllowedExtension && hasAllowedMimeType;
}
