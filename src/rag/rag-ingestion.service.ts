import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AccessLevel,
  Prisma,
  RagDocumentStatus,
  RagFileType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { mapWithConcurrency } from './rag-batch.util';
import { RAG_LIMITS } from './rag.constants';
import { ImportRagFileDto } from './dto/import-rag-file.dto';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { buildChunkEmbeddingText } from './rag-embedding-text.util';
import { RagFileParserService } from './rag-file-parser.service';
import { normalizeRagFilename } from './rag-filename.util';
import { RagTextCleanerService } from './rag-text-cleaner.service';

type ImportedDocumentResult = {
  id: number;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  brand: string | null;
  modelCode: string | null;
  source: string | null;
  accessLevel: string;
  fileType: RagFileType;
  originalFileName: string | null;
  createdAt: Date;
  updatedAt: Date;
  indexedAt: Date | null;
  status: RagDocumentStatus;
  totalChunks: number;
  totalCharacters: number;
};

type ParsedSegment = {
  title?: string;
  section?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
};

type ChunkDraft = {
  title: string;
  section: string | null;
  content: string;
  charCount: number;
  metadata?: Record<string, unknown>;
};

type ChunkPayload = ChunkDraft & {
  chunkIndex: number;
  tokenCount: number;
  embedding: string;
};

type PrismaRawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

@Injectable()
export class RagIngestionService {
  private readonly logger = new Logger(RagIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly ragFileParserService: RagFileParserService,
    private readonly ragTextCleanerService: RagTextCleanerService,
    private readonly ragChunkingService: RagChunkingService,
    private readonly ragEmbeddingService: RagEmbeddingService,
  ) { }

  private buildChunkTitle(
    baseTitle: string,
    chunkIndex: number,
    totalChunks: number,
  ) {
    if (totalChunks <= 1) {
      return baseTitle;
    }

    return `${baseTitle} - Phần ${chunkIndex + 1}`;
  }

  private estimateTokenCount(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
  }

  private async updateChunkEmbedding(
    client: PrismaRawExecutor,
    chunkId: number,
    embedding: string,
  ) {
    await client.$executeRaw`
      UPDATE "rag_chunks"
      SET "embedding" = CAST(${embedding} AS vector), "updatedAt" = now()
      WHERE "id" = ${chunkId}
    `;
  }

  private mapImportedDocument(document: {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
    source: string | null;
    accessLevel: string;
    fileType: RagFileType;
    originalFileName: string | null;
    createdAt: Date;
    updatedAt: Date;
    indexedAt: Date | null;
    status: RagDocumentStatus;
    totalChunks: number;
    totalCharacters: number;
    chunks: Array<{ content: string }>;
  }): ImportedDocumentResult {
    return {
      id: document.id,
      title: document.title,
      description: document.description,
      content: document.chunks[0]?.content || '',
      category: document.category,
      brand: document.brand,
      modelCode: document.modelCode,
      source: document.source,
      accessLevel: document.accessLevel,
      fileType: document.fileType,
      originalFileName: document.originalFileName,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      indexedAt: document.indexedAt,
      status: document.status,
      totalChunks: document.totalChunks,
      totalCharacters: document.totalCharacters,
    };
  }

  private getErrorMessage(error: unknown) {
    const responseMessage =
      error instanceof HttpException ? error.getResponse() : null;

    if (typeof responseMessage === 'string') {
      return responseMessage;
    }

    if (
      typeof responseMessage === 'object' &&
      responseMessage &&
      'message' in responseMessage
    ) {
      const message = responseMessage.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Không thể import tài liệu RAG từ file.';
  }

  private async cleanupChunks(documentId: number) {
    await this.prisma.ragChunk.deleteMany({
      where: { documentId },
    });
  }

  private async markFailed(documentId: number, error: unknown) {
    await this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.FAILED,
        errorMessage: this.getErrorMessage(error),
        indexedAt: null,
      },
    });
  }

  private async cleanupFailedImport(documentId: number, error: unknown) {
    try {
      await this.cleanupChunks(documentId);
      await this.markFailed(documentId, error);
    } catch (cleanupError) {
      this.logger.error(
        `Không thể cleanup tài liệu RAG lỗi documentId=${documentId}`,
        cleanupError,
      );
    }
  }

  private buildSegments(
    baseTitle: string,
    content: string,
    parserMetadata?: Record<string, unknown>,
    parsedSegments?: ParsedSegment[],
  ): ChunkDraft[] {
    const normalizedSegments = (segments: ChunkDraft[]) =>
      segments.filter(
        (segment) =>
          segment.charCount >= RAG_LIMITS.MIN_CHUNK_CHARS ||
          segments.length === 1,
      );

    if (parsedSegments && parsedSegments.length > 0) {
      return normalizedSegments(
        parsedSegments.flatMap((segment, segmentIndex) => {
          const chunkedSegments = this.ragChunkingService.chunk({
            content: segment.content,
          });

          return chunkedSegments.map((chunk) => ({
            title:
              segment.title ||
              this.buildChunkTitle(
                baseTitle,
                segmentIndex,
                parsedSegments.length,
              ),
            section: segment.section ?? null,
            content: chunk.content,
            charCount: chunk.charCount,
            metadata: segment.metadata ?? parserMetadata,
          }));
        }),
      );
    }

    return normalizedSegments(
      this.ragChunkingService.chunk({ content }).map((chunk) => ({
        title: this.buildChunkTitle(baseTitle, chunk.chunkIndex, 1),
        section: null,
        content: chunk.content,
        charCount: chunk.charCount,
        metadata: parserMetadata,
      })),
    );
  }

  private async ensureNoActiveDuplicate(checksum: string) {
    const existing = await this.prisma.ragDocument.findFirst({
      where: {
        checksum,
        isActive: true,
        status: {
          in: [
            RagDocumentStatus.UPLOADED,
            RagDocumentStatus.PARSING,
            RagDocumentStatus.CHUNKING,
            RagDocumentStatus.EMBEDDING,
            RagDocumentStatus.READY,
          ],
        },
      },
      select: {
        id: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      throw new ConflictException({
        message: 'File đã tồn tại trong kho tri thức RAG.',
        existingDocumentId: existing.id,
        existingStatus: existing.status,
      });
    }
  }

  private async buildChunkPayloads(
    documentId: number,
    chunks: ChunkDraft[],
    context: {
      baseTitle: string;
      category: string | null;
      brand: string | null;
      modelCode: string | null;
      source: string | null;
      accessLevel: AccessLevel;
    },
  ): Promise<ChunkPayload[]> {
    return mapWithConcurrency(
      chunks,
      RAG_LIMITS.EMBEDDING_BATCH_CONCURRENCY,
      async (chunk, index) => {
        try {
          const tokenCount = this.estimateTokenCount(chunk.content);
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              buildChunkEmbeddingText({
                documentTitle: context.baseTitle,
                category: context.category,
                brand: context.brand,
                modelCode: context.modelCode,
                source: context.source,
                accessLevel: context.accessLevel,
                chunkTitle: chunk.title,
                section: chunk.section,
                metadata: chunk.metadata,
                content: chunk.content,
              }),
            );

          return {
            chunkIndex: index,
            title: chunk.title,
            section: chunk.section,
            content: chunk.content,
            charCount: chunk.charCount,
            tokenCount,
            metadata: chunk.metadata,
            embedding: this.ragEmbeddingService.toPgVector(embeddingValues),
          };
        } catch (error) {
          this.logger.error(
            `Lỗi embedding chunk documentId=${documentId} chunkIndex=${index}`,
            error,
          );

          if (error instanceof HttpException) {
            throw error;
          }

          throw new BadRequestException(
            `Không thể tạo embedding cho chunk ${index + 1} của tài liệu.`,
          );
        }
      },
    );
  }

  private async saveChunksAndMarkReady(params: {
    documentId: number;
    chunkPayloads: ChunkPayload[];
    cleanedText: string;
    totalTokens: number;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
    tags: string[];
    accessLevel: AccessLevel;
    originalFileName: string;
  }) {
    const {
      documentId,
      chunkPayloads,
      cleanedText,
      totalTokens,
      category,
      brand,
      modelCode,
      tags,
      accessLevel,
      originalFileName,
    } = params;

    /*
      Không dùng this.prisma.$transaction lớn ở đây.

      Lý do:
      - File dài có thể tạo hàng chục chunk.
      - Mỗi chunk cần 1 query create + 1 raw SQL update vector.
      - Interactive transaction mặc định của Prisma timeout 5000ms.
      - Khi quá 5s sẽ lỗi P2028 Transaction already closed.

      Nếu có lỗi giữa chừng, catch ngoài sẽ:
      - xóa chunks đã tạo dở
      - đổi document sang FAILED
      - giữ nguyên HttpException như 429 nếu lỗi gốc là quota Gemini
    */
    for (const chunk of chunkPayloads) {
      const createdChunk = await this.prisma.ragChunk.create({
        data: {
          documentId,
          chunkIndex: chunk.chunkIndex,
          title: chunk.title,
          section: chunk.section,
          content: chunk.content,
          category,
          brand,
          modelCode,
          tags,
          accessLevel,
          charCount: chunk.charCount,
          tokenCount: chunk.tokenCount,
          metadata: chunk.metadata
            ? {
              ...chunk.metadata,
              originalFileName,
            }
            : {
              originalFileName,
            },
        },
      });

      await this.updateChunkEmbedding(
        this.prisma,
        createdChunk.id,
        chunk.embedding,
      );
    }

    return this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.READY,
        totalChunks: chunkPayloads.length,
        totalCharacters: cleanedText.length,
        totalTokens,
        indexedAt: new Date(),
        parsedAt: new Date(),
        errorMessage: null,
      },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });
  }

  async importFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file để import');
    }

    const originalFileName = normalizeRagFilename(file.originalname);

    /*
      Gán lại để các service phía sau như upload/parser dùng tên file đã normalize.
      Nếu terminal Windows vẫn hiện sai chữ "thành công" thì đó là encoding terminal,
      không phải filename trong DB.
    */
    file.originalname = originalFileName;

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const fileType = this.ragFileParserService.inferFileType(file);

    await this.ensureNoActiveDuplicate(checksum);

    const storedFileName = `${Date.now()}-${checksum.slice(0, 12)}${extname(
      originalFileName,
    ).toLowerCase()}`;

    const uploadResult = await this.uploadService.uploadFileWithMetadata(
      file,
      'rag-knowledge',
      storedFileName,
    );

    const baseTitle =
      dto.title?.trim() || originalFileName.replace(/\.[^.]+$/, '');
    const accessLevel = dto.accessLevel ?? AccessLevel.ADVANCED;
    const category = dto.category?.trim() || null;
    const brand = dto.brand?.trim() || null;
    const modelCode = dto.modelCode?.trim() || null;
    const source = dto.source?.trim() || null;
    const tags = dto.tags ?? [];
    let documentId: number | null = null;

    try {
      const createdDocument = await this.prisma.ragDocument.create({
        data: {
          title: baseTitle,
          description: dto.description?.trim() || null,
          originalFileName,
          storedFileName: uploadResult.storedFileName,
          fileUrl: uploadResult.url,
          storageKey: uploadResult.storageKey,
          mimeType: file.mimetype,
          fileType,
          fileSizeBytes: BigInt(file.size),
          checksum,
          kind: dto.kind,
          category,
          brand,
          modelCode,
          source,
          tags,
          accessLevel,
          status: RagDocumentStatus.UPLOADED,
          uploadedById,
        },
      });

      documentId = createdDocument.id;

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.PARSING,
          errorMessage: null,
        },
      });

      const parsed = await this.ragFileParserService.parse(file);
      const cleanedText = this.ragTextCleanerService.clean(parsed.content);

      if (!cleanedText) {
        throw new BadRequestException(
          'File không có nội dung hợp lệ sau khi làm sạch.',
        );
      }

      if (cleanedText.length < RAG_LIMITS.MIN_CHUNK_CHARS) {
        throw new BadRequestException(
          'Nội dung tài liệu quá ngắn sau khi parse, không đủ để tạo chunk có nghĩa.',
        );
      }

      if (cleanedText.length > RAG_LIMITS.MAX_PARSED_TEXT_CHARS) {
        throw new BadRequestException(
          'Tài liệu quá lớn sau khi parse, vui lòng chia nhỏ file theo chương hoặc chủ đề.',
        );
      }

      const chunkDrafts = this.buildSegments(
        baseTitle,
        cleanedText,
        parsed.metadata,
        parsed.segments,
      );

      if (chunkDrafts.length === 0) {
        throw new BadRequestException(
          'Không thể tách nội dung thành chunk.',
        );
      }

      if (chunkDrafts.length > RAG_LIMITS.MAX_CHUNKS_PER_DOCUMENT) {
        throw new BadRequestException(
          'Tài liệu tạo ra quá nhiều chunk, vui lòng chia nhỏ file.',
        );
      }

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.CHUNKING,
          totalCharacters: cleanedText.length,
        },
      });

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });

      const chunkPayloads = await this.buildChunkPayloads(
        documentId,
        chunkDrafts,
        {
          baseTitle,
          category,
          brand,
          modelCode,
          source,
          accessLevel,
        },
      );

      const totalTokens = chunkPayloads.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      );

      const document = await this.saveChunksAndMarkReady({
        documentId,
        chunkPayloads,
        cleanedText,
        totalTokens,
        category,
        brand,
        modelCode,
        tags,
        accessLevel,
        originalFileName,
      });

      return {
        message: 'Tài liệu đã được import, chunk và vector hóa thành công.',
        document: this.mapImportedDocument(document),
      };
    } catch (error) {
      if (documentId) {
        await this.cleanupFailedImport(documentId, error);
      }

      this.logger.error(
        `Lỗi khi import tài liệu RAG từ file ${originalFileName} (documentId=${documentId ?? 'n/a'
        })`,
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Không thể import tài liệu RAG từ file.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}