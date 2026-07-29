import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RagDocumentStatus, RagFileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapWithConcurrency } from './rag-batch.util';
import { RAG_LIMITS } from './rag.constants';
import { ArchiveRagDocumentDto } from './dto/archive-rag-document.dto';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { UpdateRagDocumentDto } from './dto/update-rag-document.dto';
import { RagDocumentChunksQueryDto } from './dto/rag-document-chunks-query.dto';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { buildChunkEmbeddingText } from './rag-embedding-text.util';
import { RagTextCleanerService } from './rag-text-cleaner.service';

type DocumentListItem = {
  id: number;
  title: string;
  description: string | null;
  content: string;
  contentPreview: string;
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
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragEmbeddingService: RagEmbeddingService,
    private readonly ragTextCleanerService: RagTextCleanerService,
    private readonly ragChunkingService: RagChunkingService,
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

  private buildContentPreview(content: string) {
    if (content.length <= RAG_LIMITS.DOCUMENT_CONTENT_PREVIEW_CHARS) {
      return content;
    }

    return `${content.slice(0, RAG_LIMITS.DOCUMENT_CONTENT_PREVIEW_CHARS)}...`;
  }

  private async ensureDocumentExists(id: number) {
    const existing = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Khong tim thay tai lieu');
    }
  }

  private buildEmbeddingText(title: string, content: string) {
    return `Tiêu đề: ${title}\nNội dung: ${content}`;
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

  private mapDocumentForAdmin(document: {
    id: number;
    title: string;
    description: string | null;
    source: string | null;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
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
  }): DocumentListItem {
    const preview = this.buildContentPreview(document.chunks[0]?.content || '');

    return {
      id: document.id,
      title: document.title,
      description: document.description,
      content: preview,
      contentPreview: preview,
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

  private buildReindexChunkDrafts(title: string, cleanedText: string) {
    const chunkDrafts = this.ragChunkingService
      .chunk({ content: cleanedText })
      .filter(
        (chunk) =>
          chunk.charCount >= RAG_LIMITS.MIN_CHUNK_CHARS ||
          cleanedText.length <= RAG_LIMITS.MIN_CHUNK_CHARS,
      );

    return chunkDrafts.map((chunk) => ({
      ...chunk,
      title: this.buildChunkTitle(title, chunk.chunkIndex, chunkDrafts.length),
      tokenCount: this.estimateTokenCount(chunk.content),
    }));
  }

  private async buildReindexPayloads(
    document: {
      id: number;
      title: string;
      category: string | null;
      brand: string | null;
      modelCode: string | null;
      accessLevel: string;
    },
    chunkDrafts: Array<{
      chunkIndex: number;
      title: string;
      content: string;
      charCount: number;
      tokenCount: number;
    }>,
  ) {
    return mapWithConcurrency(
      chunkDrafts,
      RAG_LIMITS.EMBEDDING_BATCH_CONCURRENCY,
      async (chunk, index) => {
        try {
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              buildChunkEmbeddingText({
                documentTitle: document.title,
                category: document.category,
                brand: document.brand,
                modelCode: document.modelCode,
                accessLevel: document.accessLevel,
                chunkTitle: chunk.title,
                metadata: { source: 'reindex' },
                content: chunk.content,
              }),
            );

          return {
            ...chunk,
            chunkIndex: index,
            embedding: this.ragEmbeddingService.toPgVector(embeddingValues),
          };
        } catch (error) {
          this.logger.error(
            `Loi embedding khi reindex documentId=${document.id} chunkIndex=${index}`,
            error,
          );
          if (error instanceof HttpException) {
            throw error;
          }
          throw new BadRequestException(
            `Khong the tao embedding cho chunk ${index + 1} khi reindex tai lieu.`,
          );
        }
      },
    );
  }

  async ingestDocument(dto: IngestDocumentDto) {
    const {
      title,
      content,
      category,
      description,
      brand,
      modelCode,
      source,
      tags = [],
      kind,
      accessLevel = 'ADVANCED',
    } = dto;
    const textToEmbed = buildChunkEmbeddingText({
      documentTitle: title,
      category: category || null,
      source: source || null,
      accessLevel,
      chunkTitle: title,
      content,
    });
    const embeddingValues =
      await this.ragEmbeddingService.generateEmbedding(textToEmbed);
    const embeddingString =
      this.ragEmbeddingService.toPgVector(embeddingValues);
    const totalCharacters = content.length;

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const createdDocument = await tx.ragDocument.create({
          data: {
            title,
            description: description || null,
            category: category || null,
            brand: brand || null,
            modelCode: modelCode || null,
            source: source || null,
            kind: kind || null,
            accessLevel,
            tags,
            status: RagDocumentStatus.EMBEDDING,
            totalCharacters,
          },
        });

        const createdChunk = await tx.ragChunk.create({
          data: {
            documentId: createdDocument.id,
            chunkIndex: 0,
            title,
            content,
            category: category || null,
            brand: brand || null,
            modelCode: modelCode || null,
            accessLevel,
            tags,
            charCount: totalCharacters,
            tokenCount: this.estimateTokenCount(content),
            metadata: source?.startsWith('CHAT_SESSION:')
              ? {
                  sourceType: 'CHAT_CONVERSATION',
                  source,
                }
              : undefined,
          },
        });

        await this.updateChunkEmbedding(tx, createdChunk.id, embeddingString);

        return tx.ragDocument.update({
          where: { id: createdDocument.id },
          data: {
            status: RagDocumentStatus.READY,
            totalChunks: 1,
            totalCharacters,
            indexedAt: new Date(),
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

      this.logger.log(`Da nap thanh cong tai lieu RAG moi: "${title}"`);
      return {
        message: 'Tài liệu đã được nạp và vector hóa thành công',
        document: this.mapDocumentForAdmin(document),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Lỗi khi lưu tài liệu RAG mới vào database:', error);
      throw new HttpException(
        'Không thể lưu tài liệu vào database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAllDocuments() {
    const documents = await this.prisma.ragDocument.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        source: true,
        category: true,
        brand: true,
        modelCode: true,
        accessLevel: true,
        fileType: true,
        originalFileName: true,
        createdAt: true,
        updatedAt: true,
        indexedAt: true,
        status: true,
        totalChunks: true,
        totalCharacters: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    return documents.map((document) => this.mapDocumentForAdmin(document));
  }

  async getDocumentStats() {
    const [
      totalDocuments,
      readyDocuments,
      failedDocuments,
      archivedDocuments,
      totalChunks,
      activeChunks,
      aggregate,
      documentsByFileType,
      documentsByStatus,
    ] = await Promise.all([
      this.prisma.ragDocument.count(),
      this.prisma.ragDocument.count({
        where: { status: RagDocumentStatus.READY },
      }),
      this.prisma.ragDocument.count({
        where: { status: RagDocumentStatus.FAILED },
      }),
      this.prisma.ragDocument.count({
        where: { isActive: false },
      }),
      this.prisma.ragChunk.count(),
      this.prisma.ragChunk.count({
        where: { isActive: true },
      }),
      this.prisma.ragDocument.aggregate({
        _sum: {
          totalCharacters: true,
          totalTokens: true,
        },
      }),
      this.prisma.ragDocument.groupBy({
        by: ['fileType'],
        _count: { _all: true },
      }),
      this.prisma.ragDocument.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    return {
      totalDocuments,
      readyDocuments,
      failedDocuments,
      archivedDocuments,
      totalChunks,
      activeChunks,
      totalCharacters: aggregate._sum.totalCharacters ?? 0,
      totalTokens: aggregate._sum.totalTokens ?? 0,
      documentsByFileType: documentsByFileType.map((item) => ({
        fileType: item.fileType,
        count: item._count._all,
      })),
      documentsByStatus: documentsByStatus.map((item) => ({
        status: item.status,
        count: item._count._all,
      })),
    };
  }

  async getDocumentDetail(id: number) {
    const document = await this.prisma.ragDocument.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            email: true,
          },
        },
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 10,
          select: {
            id: true,
            chunkIndex: true,
            title: true,
            section: true,
            content: true,
            charCount: true,
            tokenCount: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Khong tim thay tai lieu');
    }

    return {
      id: document.id,
      title: document.title,
      description: document.description,
      category: document.category,
      brand: document.brand,
      modelCode: document.modelCode,
      source: document.source,
      tags: document.tags,
      accessLevel: document.accessLevel,
      kind: document.kind,
      status: document.status,
      errorMessage: document.errorMessage,
      fileType: document.fileType,
      originalFileName: document.originalFileName,
      storedFileName: document.storedFileName,
      fileUrl: document.fileUrl,
      storageKey: document.storageKey,
      mimeType: document.mimeType,
      fileSizeBytes:
        document.fileSizeBytes != null ? document.fileSizeBytes.toString() : null,
      checksum: document.checksum,
      totalChunks: document.totalChunks,
      totalCharacters: document.totalCharacters,
      totalTokens: document.totalTokens,
      version: document.version,
      isActive: document.isActive,
      uploadedById: document.uploadedById,
      parsedAt: document.parsedAt,
      indexedAt: document.indexedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      uploadedBy: document.uploadedBy,
      chunksPreview: document.chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        title: chunk.title,
        section: chunk.section,
        contentPreview:
          chunk.content.length > RAG_LIMITS.DOCUMENT_CONTENT_PREVIEW_CHARS
            ? `${chunk.content.slice(0, RAG_LIMITS.DOCUMENT_CONTENT_PREVIEW_CHARS)}...`
            : chunk.content,
        charCount: chunk.charCount,
        tokenCount: chunk.tokenCount,
        isActive: chunk.isActive,
        createdAt: chunk.createdAt,
      })),
    };
  }

  async getDocumentChunks(id: number, query: RagDocumentChunksQueryDto) {
    const document = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        totalChunks: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Khong tim thay tai lieu');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClauses: Prisma.Sql[] = [Prisma.sql`c."documentId" = ${id}`];

    if (typeof query.isActive === 'boolean') {
      whereClauses.push(Prisma.sql`c."isActive" = ${query.isActive}`);
    }

    const keyword = query.search?.trim();
    if (keyword) {
      const pattern = `%${keyword}%`;
      whereClauses.push(
        Prisma.sql`(
          COALESCE(c."title", '') ILIKE ${pattern}
          OR COALESCE(c."section", '') ILIKE ${pattern}
          OR c."content" ILIKE ${pattern}
        )`,
      );
    }

    const whereSql = Prisma.join(whereClauses, ' AND ');

    const [countRows, chunks] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total"
        FROM "rag_chunks" c
        WHERE ${whereSql}
      `,
      this.prisma.$queryRaw<
        Array<{
          id: number;
          documentId: number;
          chunkIndex: number;
          title: string | null;
          section: string | null;
          content: string;
          pageNumber: number | null;
          sheetName: string | null;
          rowIndex: number | null;
          metadata: Prisma.JsonValue | null;
          category: string | null;
          brand: string | null;
          modelCode: string | null;
          tags: string[];
          accessLevel: string;
          tokenCount: number | null;
          charCount: number | null;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
          hasEmbedding: boolean;
        }>
      >`
        SELECT
          c."id",
          c."documentId",
          c."chunkIndex",
          c."title",
          c."section",
          c."content",
          c."pageNumber",
          c."sheetName",
          c."rowIndex",
          c."metadata",
          c."category",
          c."brand",
          c."modelCode",
          c."tags",
          c."accessLevel"::text AS "accessLevel",
          c."tokenCount",
          c."charCount",
          c."isActive",
          c."createdAt",
          c."updatedAt",
          (c."embedding" IS NOT NULL) AS "hasEmbedding"
        FROM "rag_chunks" c
        WHERE ${whereSql}
        ORDER BY c."chunkIndex" ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
    ]);

    const total = countRows[0]?.total ?? 0;

    return {
      document,
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
      chunks,
    };
  }

  async getChunkDetail(chunkId: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        documentId: number;
        chunkIndex: number;
        title: string | null;
        section: string | null;
        content: string;
        pageNumber: number | null;
        sheetName: string | null;
        rowIndex: number | null;
        metadata: Prisma.JsonValue | null;
        category: string | null;
        brand: string | null;
        modelCode: string | null;
        tags: string[];
        accessLevel: string;
        tokenCount: number | null;
        charCount: number | null;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        hasEmbedding: boolean;
        documentTitle: string;
        documentStatus: RagDocumentStatus;
        documentIsActive: boolean;
      }>
    >`
      SELECT
        c."id",
        c."documentId",
        c."chunkIndex",
        c."title",
        c."section",
        c."content",
        c."pageNumber",
        c."sheetName",
        c."rowIndex",
        c."metadata",
        c."category",
        c."brand",
        c."modelCode",
        c."tags",
        c."accessLevel"::text AS "accessLevel",
        c."tokenCount",
        c."charCount",
        c."isActive",
        c."createdAt",
        c."updatedAt",
        (c."embedding" IS NOT NULL) AS "hasEmbedding",
        d."title" AS "documentTitle",
        d."status" AS "documentStatus",
        d."isActive" AS "documentIsActive"
      FROM "rag_chunks" c
      INNER JOIN "rag_documents" d ON d."id" = c."documentId"
      WHERE c."id" = ${chunkId}
      LIMIT 1
    `;

    const chunk = rows[0];
    if (!chunk) {
      throw new NotFoundException('Khong tim thay chunk');
    }

    return {
      id: chunk.id,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      title: chunk.title,
      section: chunk.section,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      sheetName: chunk.sheetName,
      rowIndex: chunk.rowIndex,
      metadata: chunk.metadata,
      category: chunk.category,
      brand: chunk.brand,
      modelCode: chunk.modelCode,
      tags: chunk.tags,
      accessLevel: chunk.accessLevel,
      tokenCount: chunk.tokenCount,
      charCount: chunk.charCount,
      isActive: chunk.isActive,
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt,
      hasEmbedding: chunk.hasEmbedding,
      document: {
        id: chunk.documentId,
        title: chunk.documentTitle,
        status: chunk.documentStatus,
        isActive: chunk.documentIsActive,
      },
    };
  }

  async updateDocument(id: number, dto: UpdateRagDocumentDto) {
    const existing = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    const {
      title,
      description,
      kind,
      category,
      brand,
      modelCode,
      source,
      tags,
      accessLevel,
    } = dto;

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        // 1. Cập nhật RagDocument
        const updatedDoc = await tx.ragDocument.update({
          where: { id },
          data: {
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            ...(kind !== undefined && { kind }),
            ...(category !== undefined && { category }),
            ...(brand !== undefined && { brand }),
            ...(modelCode !== undefined && { modelCode }),
            ...(source !== undefined && { source }),
            ...(tags !== undefined && { tags }),
            ...(accessLevel !== undefined && { accessLevel }),
          },
          include: {
            chunks: {
              orderBy: { chunkIndex: 'asc' },
              take: 1,
              select: { content: true },
            },
          },
        });

        // 2. Cập nhật đồng bộ các Chunk thuộc tài liệu này
        await tx.ragChunk.updateMany({
          where: { documentId: id },
          data: {
            ...(category !== undefined && { category }),
            ...(brand !== undefined && { brand }),
            ...(modelCode !== undefined && { modelCode }),
            ...(tags !== undefined && { tags }),
            ...(accessLevel !== undefined && { accessLevel }),
          },
        });

        return updatedDoc;
      });

      return {
        message: 'Tài liệu đã được cập nhật thành công',
        document: this.mapDocumentForAdmin(document),
      };
    } catch (error) {
      this.logger.error('Lỗi khi cập nhật tài liệu RAG:', error);
      throw new HttpException(
        'Không thể cập nhật tài liệu trong database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async archiveDocument(id: number, dto: ArchiveRagDocumentDto) {
    await this.ensureDocumentExists(id);

    const document = await this.prisma.$transaction(async (tx) => {
      await tx.ragChunk.updateMany({
        where: { documentId: id },
        data: { isActive: dto.isActive },
      });

      return tx.ragDocument.update({
        where: { id },
        data: { isActive: dto.isActive },
        select: {
          id: true,
          title: true,
          status: true,
          isActive: true,
          totalChunks: true,
          updatedAt: true,
        },
      });
    });

    return {
      message: dto.isActive
        ? 'Tai lieu da duoc mo lai de su dung'
        : 'Tai lieu da duoc archive',
      document,
    };
  }

  async reindexDocument(id: number) {
    const document = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        category: true,
        brand: true,
        modelCode: true,
        tags: true,
        accessLevel: true,
        isActive: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            content: true,
            isActive: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Khong tim thay tai lieu');
    }

    const activeChunks = document.chunks.filter((chunk) => chunk.isActive);
    const sourceChunks = activeChunks.length > 0 ? activeChunks : document.chunks;
    const sourceText = sourceChunks.map((chunk) => chunk.content).join('\n\n');

    if (!sourceText.trim()) {
      throw new BadRequestException('Tai lieu khong co noi dung de reindex');
    }

    try {
      await this.prisma.ragDocument.update({
        where: { id },
        data: {
          status: RagDocumentStatus.CHUNKING,
          errorMessage: null,
        },
      });

      const cleanedText = this.ragTextCleanerService.clean(sourceText);
      if (!cleanedText) {
        throw new BadRequestException('Tai lieu khong con noi dung hop le sau khi lam sach');
      }
      if (cleanedText.length < RAG_LIMITS.MIN_CHUNK_CHARS) {
        throw new BadRequestException(
          'Noi dung tai lieu qua ngan sau khi lam sach, khong du de reindex.',
        );
      }
      if (cleanedText.length > RAG_LIMITS.MAX_PARSED_TEXT_CHARS) {
        throw new BadRequestException(
          'Tai lieu qua lon sau khi parse, vui long chia nho file theo chuong hoac chu de.',
        );
      }

      const chunkDrafts = this.buildReindexChunkDrafts(
        document.title,
        cleanedText,
      );

      if (chunkDrafts.length === 0) {
        throw new BadRequestException('Khong the tao chunk moi tu tai lieu hien tai');
      }
      if (chunkDrafts.length > RAG_LIMITS.MAX_CHUNKS_PER_DOCUMENT) {
        throw new BadRequestException(
          'Tai lieu tao ra qua nhieu chunk, vui long chia nho file.',
        );
      }

      await this.prisma.ragDocument.update({
        where: { id },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });

      const preparedChunks = await this.buildReindexPayloads(
        {
          id: document.id,
          title: document.title,
          category: document.category,
          brand: document.brand,
          modelCode: document.modelCode,
          accessLevel: document.accessLevel,
        },
        chunkDrafts,
      );

      const totalTokens = preparedChunks.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      );

      const updatedDocument = await this.prisma.$transaction(async (tx) => {
        await tx.ragChunk.deleteMany({
          where: { documentId: id },
        });

        for (const chunk of preparedChunks) {
          const createdChunk = await tx.ragChunk.create({
            data: {
              documentId: id,
              chunkIndex: chunk.chunkIndex,
              title: this.buildChunkTitle(
                document.title,
                chunk.chunkIndex,
                preparedChunks.length,
              ),
              content: chunk.content,
              category: document.category,
              brand: document.brand,
              modelCode: document.modelCode,
              tags: document.tags,
              accessLevel: document.accessLevel,
              charCount: chunk.charCount,
              tokenCount: chunk.tokenCount,
              isActive: document.isActive,
              metadata: {
                source: 'reindex',
                reindexedAt: new Date().toISOString(),
              },
            },
          });

          await this.updateChunkEmbedding(tx, createdChunk.id, chunk.embedding);
        }

        return tx.ragDocument.update({
          where: { id },
          data: {
            status: RagDocumentStatus.READY,
            totalChunks: preparedChunks.length,
            totalCharacters: cleanedText.length,
            totalTokens,
            indexedAt: new Date(),
            parsedAt: new Date(),
            errorMessage: null,
          },
          select: {
            id: true,
            title: true,
            status: true,
            totalChunks: true,
            totalCharacters: true,
            totalTokens: true,
            indexedAt: true,
          },
        });
      });

      return {
        message: 'Tai lieu da duoc reindex thanh cong',
        document: updatedDocument,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Khong the reindex tai lieu';

      await this.prisma.ragDocument.update({
        where: { id },
        data: {
          status: RagDocumentStatus.FAILED,
          errorMessage,
        },
      });

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Loi khi reindex tai lieu RAG', error);
      throw new HttpException(
        'Khong the reindex tai lieu',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteDocument(id: number) {
    const existing = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    try {
      await this.prisma.ragDocument.delete({
        where: { id },
      });

      return {
        message: 'Tài liệu đã được xóa thành công',
        id,
      };
    } catch (error) {
      this.logger.error('Lỗi khi xóa tài liệu RAG mới trong database:', error);
      throw new HttpException(
        'Không thể xóa tài liệu trong database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
