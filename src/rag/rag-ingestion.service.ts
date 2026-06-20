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
import { buildChunkEmbeddingText } from './rag-embedding-text.util';
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

type ParsedSegment = {
  title?: string;
  section?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
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

  private buildChunkTitle(
    baseTitle: string,
    chunkIndex: number,
    totalChunks: number,
  ) {
    if (totalChunks <= 1) {
      return baseTitle;
    }

    return `${baseTitle} - Phan ${chunkIndex + 1}`;
  }

  private estimateTokenCount(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
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
      error instanceof Error ? error.message : 'Khong the import tai lieu';

    await this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.FAILED,
        errorMessage: message,
      },
    });
  }

  private buildSegments(
    baseTitle: string,
    content: string,
    parserMetadata?: Record<string, unknown>,
    parsedSegments?: ParsedSegment[],
  ) {
    if (parsedSegments && parsedSegments.length > 0) {
      return parsedSegments.flatMap((segment, segmentIndex) => {
        const chunkedSegments = this.ragChunkingService.chunk({
          content: segment.content,
        });

        return chunkedSegments.map((chunk) => ({
          title:
            segment.title ||
            this.buildChunkTitle(baseTitle, segmentIndex, parsedSegments.length),
          section: segment.section ?? null,
          content: chunk.content,
          charCount: chunk.charCount,
          metadata: segment.metadata ?? parserMetadata,
        }));
      });
    }

    return this.ragChunkingService.chunk({ content }).map((chunk) => ({
      title: this.buildChunkTitle(baseTitle, chunk.chunkIndex, 1),
      section: null,
      content: chunk.content,
      charCount: chunk.charCount,
      metadata: parserMetadata,
    }));
  }

  async importFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    if (!file) {
      throw new BadRequestException('Khong tim thay file de import');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const fileType = this.ragFileParserService.inferFileType(file);
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
        throw new BadRequestException('File khong co noi dung hop le sau khi lam sach');
      }

      const chunkDrafts = this.buildSegments(
        baseTitle,
        cleanedText,
        parsed.metadata,
        parsed.segments,
      );
      if (chunkDrafts.length === 0) {
        throw new BadRequestException('Khong the tach noi dung thanh chunk');
      }

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.CHUNKING,
          totalCharacters: cleanedText.length,
        },
      });

      const chunkPayloads = await Promise.all(
        chunkDrafts.map(async (chunk, index) => {
          const tokenCount = this.estimateTokenCount(chunk.content);
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              buildChunkEmbeddingText({
                documentTitle: baseTitle,
                category,
                brand,
                modelCode,
                source,
                accessLevel,
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
        }),
      );

      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });

      const totalTokens = chunkPayloads.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      );

      const document = await this.prisma.$transaction(async (tx) => {
        for (const chunk of chunkPayloads) {
          const createdChunk = await tx.ragChunk.create({
            data: {
              documentId: documentId!,
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
      });

      return {
        message: 'Tai lieu da duoc import, chunk va vector hoa thanh cong',
        document: this.mapImportedDocument(document),
      };
    } catch (error) {
      if (documentId) {
        await this.markFailed(documentId, error);
      }

      this.logger.error(
        `Loi khi import tai lieu RAG tu file ${file.originalname} (documentId=${documentId ?? 'n/a'})`,
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Khong the import tai lieu RAG tu file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
