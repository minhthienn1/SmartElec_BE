import {
  BadRequestException,
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
import { ImportRagFileDto } from './dto/import-rag-file.dto';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagFileParserService } from './rag-file-parser.service';
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
  ) {}

  private buildEmbeddingText(title: string, content: string) {
    return `Tiêu đề: ${title}\nNội dung: ${content}`;
  }

  private buildChunkTitle(baseTitle: string, chunkIndex: number, totalChunks: number) {
    if (totalChunks <= 1) {
      return baseTitle;
    }

    return `${baseTitle} - Phần ${chunkIndex + 1}`;
  }

  private async updateChunkEmbedding(
    tx: Prisma.TransactionClient,
    chunkId: number,
    embedding: string,
  ) {
    await tx.$executeRaw`
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

  private async markFailed(documentId: number, error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Không thể import tài liệu';

    await this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.FAILED,
        errorMessage: message,
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

    const parsed = this.ragFileParserService.parse(file);
    const cleanedText = this.ragTextCleanerService.clean(parsed.content);
    if (!cleanedText) {
      throw new BadRequestException('File không có nội dung hợp lệ sau khi làm sạch');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storedFileName = `${Date.now()}-${checksum.slice(0, 12)}${extname(file.originalname).toLowerCase()}`;
    const uploadResult = await this.uploadService.uploadFileWithMetadata(
      file,
      'rag-knowledge',
      storedFileName,
    );

    const baseTitle =
      dto.title?.trim() || file.originalname.replace(/\.[^.]+$/, '');
    const accessLevel = dto.accessLevel ?? AccessLevel.ADVANCED;
    const category = dto.category?.trim() || null;
    const brand = dto.brand?.trim() || null;
    const modelCode = dto.modelCode?.trim() || null;
    const source = dto.source?.trim() || null;
    const tags = dto.tags ?? [];
    const chunks = this.ragChunkingService.chunk({ content: cleanedText });
    if (chunks.length === 0) {
      throw new BadRequestException('Không thể tách nội dung thành chunk');
    }

    let documentId: number | null = null;

    try {
      const createdDocument = await this.prisma.ragDocument.create({
        data: {
          title: baseTitle,
          description: dto.description?.trim() || null,
          originalFileName: file.originalname,
          storedFileName: uploadResult.storedFileName,
          fileUrl: uploadResult.url,
          storageKey: uploadResult.storageKey,
          mimeType: file.mimetype,
          fileType: parsed.fileType,
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

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.CHUNKING,
          totalCharacters: cleanedText.length,
        },
      });

      const chunkPayloads = await Promise.all(
        chunks.map(async (chunk) => {
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              this.buildEmbeddingText(baseTitle, chunk.content),
            );

          return {
            ...chunk,
            embedding: this.ragEmbeddingService.toPgVector(embeddingValues),
          };
        }),
      );

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });

      const document = await this.prisma.$transaction(async (tx) => {
        for (const chunk of chunkPayloads) {
          const createdChunk = await tx.ragChunk.create({
            data: {
              documentId: documentId!,
              chunkIndex: chunk.chunkIndex,
              title: this.buildChunkTitle(
                baseTitle,
                chunk.chunkIndex,
                chunkPayloads.length,
              ),
              content: chunk.content,
              category,
              brand,
              modelCode,
              tags,
              accessLevel,
              charCount: chunk.charCount,
              metadata: parsed.metadata
                ? {
                    ...parsed.metadata,
                    originalFileName: file.originalname,
                  }
                : {
                    originalFileName: file.originalname,
                  },
            },
          });

          await this.updateChunkEmbedding(tx, createdChunk.id, chunk.embedding);
        }

        return tx.ragDocument.update({
          where: { id: documentId! },
          data: {
            status: RagDocumentStatus.READY,
            totalChunks: chunkPayloads.length,
            totalCharacters: cleanedText.length,
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
      });

      return {
        message: 'Tài liệu đã được import, chunk và vector hóa thành công',
        document: this.mapImportedDocument(document),
      };
    } catch (error) {
      if (documentId) {
        await this.markFailed(documentId, error);
      }

      this.logger.error('Lỗi khi import tài liệu RAG từ file', error);
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Không thể import tài liệu RAG từ file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
