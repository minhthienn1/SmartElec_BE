import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class MechanicAiService {
  private readonly logger = new Logger(MechanicAiService.name);
  private genAI: GoogleGenerativeAI;
  private embeddingModel: GenerativeModel;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    // 1. Khởi tạo Embedding Model (Google đã đổi tên model thành gemini-embedding-2)
    this.embeddingModel = this.genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  }

  // 2. Viết hàm ingestDocument
  async ingestDocument(
    title: string,
    content: string,
    category: string | null = null,
    source: string | null = null,
    accessLevel: 'BASIC' | 'ADVANCED' = 'ADVANCED',
  ) {
    if (!title || !content) {
      throw new HttpException('Thiếu title hoặc content', HttpStatus.BAD_REQUEST);
    }

    try {
      // Bước 1: Lấy về mảng vector (ép về 768 chiều để khớp với Database)
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text: content }], role: 'user' },
        // @ts-ignore - Thuộc tính này có thể báo lỗi TypeScript ở bản SDK cũ nhưng API vẫn nhận
        outputDimensionality: 768,
      });
      const embeddingValues = result.embedding.values;

      // Chuẩn bị mảng vector dưới dạng string để pgvector có thể đọc
      const vectorStr = `[${embeddingValues.join(',')}]`;

      // Bước 2: Lưu vào DB dùng $executeRaw
      // Chú ý dùng đúng tên bảng "technical_documents" theo @@map trong Prisma
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
          ${category}, 
          ${source}, 
          CAST(${accessLevel} AS "AccessLevel"), 
          CAST(${vectorStr} AS vector), 
          now()
        )
      `;

      this.logger.log(`✅ Đã nạp thành công tài liệu: "${title}" (768d vector)`);
      return {
        message: 'Tài liệu đã được nạp và vector hóa thành công',
        data: { title, category, accessLevel },
      };
    } catch (error) {
      this.logger.error('Lỗi khi nạp tài liệu RAG vào DB:', error);
      throw new HttpException(
        'Không thể nạp tài liệu',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // 3. Hàm truy xuất tài liệu (Retrieval/Similarity Search)
  async findRelevantDocs(
    query: string,
    accessLevel: 'BASIC' | 'ADVANCED',
    limit: number = 3,
  ) {
    if (!query) {
      throw new HttpException('Thiếu câu hỏi (query)', HttpStatus.BAD_REQUEST);
    }

    try {
      // Bước A: Biến câu hỏi thành Vector (768 chiều)
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text: query }], role: 'user' },
        // @ts-ignore
        outputDimensionality: 768,
      });
      const embeddingValues = result.embedding.values;
      const vectorStr = `[${embeddingValues.join(',')}]`;

      // Bước B: Tìm kiếm Cosine Similarity với pgvector (<=>)
      // Nếu quyền là ADVANCED thì tìm cả BASIC và ADVANCED, nếu BASIC thì chỉ lấy BASIC
      const documents = await this.prisma.$queryRaw`
        SELECT id, title, content, category, "accessLevel", 
               (embedding <=> CAST(${vectorStr} AS vector)) as distance
        FROM "technical_documents"
        WHERE ("accessLevel" = 'BASIC'::"AccessLevel" OR CAST(${accessLevel} AS text) = 'ADVANCED')
        ORDER BY distance ASC
        LIMIT ${limit}
      `;

      return {
        message: 'Tìm kiếm thành công',
        results: documents,
      };
    } catch (error) {
      this.logger.error('Lỗi khi search tài liệu RAG:', error);
      throw new HttpException('Lỗi khi truy xuất tài liệu', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
