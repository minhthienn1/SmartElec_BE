import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, RagDocumentStatus, RagFileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { RagEmbeddingService } from './rag-embedding.service';

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
  ) {}

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
    const textToEmbed = this.buildEmbeddingText(title, content);
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

  async updateDocument(id: number, dto: IngestDocumentDto) {
    const existing = await this.prisma.ragDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    const { title, content, category, source, accessLevel = 'ADVANCED' } = dto;
    const textToEmbed = this.buildEmbeddingText(title, content);
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
