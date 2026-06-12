import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { IngestDocumentDto } from './dto/ingest-document.dto';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private genAI: GoogleGenerativeAI;
  private embeddingModel: GenerativeModel;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-001',
    });
  }

  /**
   * Tạo vector embedding từ văn bản sử dụng mô hình text-embedding-004
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text }], role: 'user' },
        // @ts-ignore SDK cũ có thể chưa khai báo field này nhưng API vẫn hỗ trợ.
        outputDimensionality: 768,
      });
      return result.embedding.values;
    } catch (error) {
      this.logger.error('Lỗi khi tạo embedding từ Gemini:', error);
      throw new HttpException(
        'Không thể tạo embedding cho tài liệu',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Ingest (Nạp) một tài liệu mới vào cơ sở dữ liệu
   */
  async ingestDocument(dto: IngestDocumentDto) {
    const { title, content, category, source, accessLevel = 'ADVANCED' } = dto;

    // 1. Tạo embedding từ nội dung
    // Để tối ưu, ta có thể embed cả title + content
    const textToEmbed = `Tiêu đề: ${title}\nNội dung: ${content}`;
    const embeddingValues = await this.generateEmbedding(textToEmbed);

    // 2. Format embedding thành chuỗi vector cho pgvector: "[0.1, 0.2, ...]"
    const embeddingString = `[${embeddingValues.join(',')}]`;

    try {
      // 3. Lưu vào DB bằng Raw Query (do Prisma chưa support native type Unsupported("vector"))
      // Chú ý: Cần xử lý cẩn thận SQL Injection nếu biến không được pass qua param
      await this.prisma.$executeRaw`
        INSERT INTO "technical_documents" (
          "title", 
          "content", 
          "category", 
          "source", 
          "accessLevel", 
          "embedding", 
          "updatedAt"
        )
        VALUES (
          ${title}, 
          ${content}, 
          ${category || null}, 
          ${source || null}, 
          CAST(${accessLevel} AS "AccessLevel"), 
          CAST(${embeddingString} AS vector), 
          now()
        )
      `;

      this.logger.log(`✅ Đã nạp thành công tài liệu: "${title}"`);
      return {
        message: 'Tài liệu đã được nạp và vector hóa thành công',
        document: { title, category, accessLevel },
      };
    } catch (error) {
      this.logger.error('Lỗi khi lưu tài liệu vào database:', error);
      throw new HttpException(
        'Không thể lưu tài liệu vào database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Lấy danh sách tài liệu (không kèm vector để nhẹ payload)
   */
  /** Lấy danh sách tài liệu đã nạp kèm nội dung để admin có thể xem trực tiếp trên FE. */
  async getAllDocuments() {
    return this.prisma.$queryRaw`
      SELECT id, title, content, category, source, "accessLevel", "createdAt", "updatedAt"
      FROM "technical_documents"
      ORDER BY "createdAt" DESC
    `;
  }

  /**
   * Cập nhật tài liệu hiện có và vector hóa lại để dữ liệu RAG không bị lệch nội dung.
   */
  async updateDocument(id: number, dto: IngestDocumentDto) {
    const existing = await this.prisma.technicalDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    const { title, content, category, source, accessLevel = 'ADVANCED' } = dto;
    const textToEmbed = `Tiêu đề: ${title}\nNội dung: ${content}`;
    const embeddingValues = await this.generateEmbedding(textToEmbed);
    const embeddingString = `[${embeddingValues.join(',')}]`;

    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: number;
          title: string;
          content: string;
          category: string | null;
          source: string | null;
          accessLevel: string;
          createdAt: Date;
          updatedAt: Date;
        }>
      >`
        UPDATE "technical_documents"
        SET
          "title" = ${title},
          "content" = ${content},
          "category" = ${category || null},
          "source" = ${source || null},
          "accessLevel" = CAST(${accessLevel} AS "AccessLevel"),
          "embedding" = CAST(${embeddingString} AS vector),
          "updatedAt" = now()
        WHERE "id" = ${id}
        RETURNING id, title, content, category, source, "accessLevel", "createdAt", "updatedAt"
      `;

      return {
        message: 'Tài liệu đã được cập nhật và vector hóa lại thành công',
        document: rows[0] ?? null,
      };
    } catch (error) {
      this.logger.error('Lỗi khi cập nhật tài liệu trong database:', error);
      throw new HttpException(
        'Không thể cập nhật tài liệu trong database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Xóa tài liệu khỏi kho tri thức RAG.
   */
  async deleteDocument(id: number) {
    const existing = await this.prisma.technicalDocument.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new HttpException('Không tìm thấy tài liệu', HttpStatus.NOT_FOUND);
    }

    try {
      await this.prisma.technicalDocument.delete({
        where: { id },
      });

      return {
        message: 'Tài liệu đã được xóa thành công',
        id,
      };
    } catch (error) {
      this.logger.error('Lỗi khi xóa tài liệu trong database:', error);

      throw new HttpException(
        'Không thể xóa tài liệu trong database',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
