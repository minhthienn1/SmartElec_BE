import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AccessLevel, Prisma, RagDocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RagEmbeddingService } from './rag-embedding.service';

type RetrievalParams = {
  query: string;
  accessLevel: 'BASIC' | 'ADVANCED';
  limit?: number;
  category?: string | null;
  brand?: string | null;
  modelCode?: string | null;
};

type RetrievalRow = {
  id: number;
  chunkId: number;
  documentId: number;
  documentTitle: string;
  title: string | null;
  section: string | null;
  content: string;
  category: string | null;
  brand: string | null;
  modelCode: string | null;
  source: string | null;
  accessLevel: string;
  distance: number;
  score: number;
};

@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragEmbeddingService: RagEmbeddingService,
  ) {}

  async findRelevantChunks(
    params: RetrievalParams,
  ): Promise<{ message: string; results: RetrievalRow[] }> {
    const {
      query,
      accessLevel,
      limit = 3,
      category,
      brand,
      modelCode,
    } = params;

    if (!query?.trim()) {
      throw new HttpException('Thiếu câu hỏi (query)', HttpStatus.BAD_REQUEST);
    }

    try {
      const embeddingValues =
        await this.ragEmbeddingService.generateEmbedding(query);
      const vector = this.ragEmbeddingService.toPgVector(embeddingValues);

      const whereClauses: Prisma.Sql[] = [
        Prisma.sql`c."isActive" = true`,
        Prisma.sql`d."isActive" = true`,
        Prisma.sql`d."status" = ${RagDocumentStatus.READY}::"RagDocumentStatus"`,
        Prisma.sql`c."embedding" IS NOT NULL`,
      ];

      if (accessLevel === AccessLevel.BASIC) {
        whereClauses.push(
          Prisma.sql`c."accessLevel" = ${AccessLevel.BASIC}::"AccessLevel"`,
        );
      } else {
        whereClauses.push(
          Prisma.sql`c."accessLevel" IN (${AccessLevel.BASIC}::"AccessLevel", ${AccessLevel.ADVANCED}::"AccessLevel")`,
        );
      }

      if (category) {
        whereClauses.push(
          Prisma.sql`COALESCE(c."category", d."category") = ${category}`,
        );
      }

      if (brand) {
        whereClauses.push(
          Prisma.sql`COALESCE(c."brand", d."brand") = ${brand}`,
        );
      }

      if (modelCode) {
        whereClauses.push(
          Prisma.sql`COALESCE(c."modelCode", d."modelCode") = ${modelCode}`,
        );
      }

      const whereSql = Prisma.join(whereClauses, ' AND ');

      const results = await this.prisma.$queryRaw<RetrievalRow[]>`
        SELECT
          c."id" AS "id",
          c."id" AS "chunkId",
          c."documentId" AS "documentId",
          d."title" AS "documentTitle",
          COALESCE(c."title", d."title") AS "title",
          c."section" AS "section",
          c."content" AS "content",
          COALESCE(c."category", d."category") AS "category",
          COALESCE(c."brand", d."brand") AS "brand",
          COALESCE(c."modelCode", d."modelCode") AS "modelCode",
          d."source" AS "source",
          c."accessLevel"::text AS "accessLevel",
          (c."embedding" <=> CAST(${vector} AS vector))::double precision AS "distance",
          (1 - (c."embedding" <=> CAST(${vector} AS vector)))::double precision AS "score"
        FROM "rag_chunks" c
        INNER JOIN "rag_documents" d ON d."id" = c."documentId"
        WHERE ${whereSql}
        ORDER BY "distance" ASC
        LIMIT ${limit}
      `;

      return {
        message: 'Tìm kiếm thành công',
        results,
      };
    } catch (error) {
      this.logger.error('Lỗi khi truy xuất RagChunk', error);
      throw new HttpException(
        'Lỗi khi truy xuất tài liệu RAG',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
