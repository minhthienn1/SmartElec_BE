import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { IngestDocumentDto } from './dto/ingest-document.dto';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private genAI: GoogleGenerativeAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Tạo vector embedding từ văn bản sử dụng mô hình text-embedding-004
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(text);
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
  async getAllDocuments() {
    return this.prisma.$queryRaw`
      SELECT id, title, category, source, "accessLevel", "createdAt", "updatedAt"
      FROM "technical_documents"
      ORDER BY "createdAt" DESC
    `;
  }
}
