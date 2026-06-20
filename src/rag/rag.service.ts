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
import { ArchiveRagDocumentDto } from './dto/archive-rag-document.dto';
import { IngestDocumentDto } from './dto/ingest-document.dto';
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

  async ingestDocument(dto: IngestDocumentDto) {
    const { title, content, category, source, accessLevel = 'ADVANCED' } = dto;
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
            category: category || null,
            source: source || null,
            accessLevel,
            tags: [],
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
            accessLevel,
            tags: [],
            charCount: totalCharacters,
            tokenCount: this.estimateTokenCount(content),
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
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    return documents.map((document) => this.mapDocumentForAdmin(document));
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
          chunk.content.length > 240
            ? `${chunk.content.slice(0, 240)}...`
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

  async updateDocument(id: number, dto: IngestDocumentDto) {
    const existing = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    const { title, content, category, source, accessLevel = 'ADVANCED' } = dto;
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
        await tx.ragDocument.update({
          where: { id },
          data: {
            title,
            category: category || null,
            source: source || null,
            accessLevel,
            status: RagDocumentStatus.EMBEDDING,
            totalCharacters,
          },
        });

        const chunk = await tx.ragChunk.upsert({
          where: {
            documentId_chunkIndex: {
              documentId: id,
              chunkIndex: 0,
            },
          },
          update: {
            title,
            content,
            category: category || null,
            accessLevel,
            charCount: totalCharacters,
            tokenCount: this.estimateTokenCount(content),
          },
          create: {
            documentId: id,
            chunkIndex: 0,
            title,
            content,
            category: category || null,
            accessLevel,
            tags: [],
            charCount: totalCharacters,
            tokenCount: this.estimateTokenCount(content),
          },
        });

        await this.updateChunkEmbedding(tx, chunk.id, embeddingString);

        return tx.ragDocument.update({
          where: { id },
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

      return {
        message: 'Tài liệu đã được cập nhật và vector hóa lại thành công',
        document: this.mapDocumentForAdmin(document),
      };
    } catch (error) {
      this.logger.error('Lỗi khi cập nhật tài liệu RAG mới trong database:', error);
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
      const chunkDrafts = this.ragChunkingService.chunk({ content: cleanedText });

      if (chunkDrafts.length === 0) {
        throw new BadRequestException('Khong the tao chunk moi tu tai lieu hien tai');
      }

      const preparedChunks = await Promise.all(
        chunkDrafts.map(async (chunk) => {
          const tokenCount = this.estimateTokenCount(chunk.content);
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              buildChunkEmbeddingText({
                documentTitle: document.title,
                category: document.category,
                brand: document.brand,
                modelCode: document.modelCode,
                accessLevel: document.accessLevel,
                chunkTitle: this.buildChunkTitle(
                  document.title,
                  chunk.chunkIndex,
                  chunkDrafts.length,
                ),
                content: chunk.content,
              }),
            );

          return {
            ...chunk,
            tokenCount,
            embedding: this.ragEmbeddingService.toPgVector(embeddingValues),
          };
        }),
      );

      await this.prisma.ragDocument.update({
        where: { id },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });

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
