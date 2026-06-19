import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class RagEmbeddingService {
  private readonly logger = new Logger(RagEmbeddingService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly embeddingModel: GenerativeModel;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-001',
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModel.embedContent({
        content: { parts: [{ text }], role: 'user' },
        // @ts-ignore SDK cũ có thể chưa khai báo field này nhưng API vẫn hỗ trợ.
        outputDimensionality: 768,
      });

      return result.embedding.values;
    } catch (error) {
      this.logger.error('Lỗi khi tạo embedding cho RAG', error);
      throw new InternalServerErrorException(
        'Không thể tạo embedding cho dữ liệu RAG',
      );
    }
  }

  toPgVector(values: number[]): string {
    if (!Array.isArray(values) || values.length === 0) {
      this.logger.error('Embedding rỗng, không thể chuyển sang pgvector');
      throw new InternalServerErrorException('Embedding không hợp lệ');
    }

    return `[${values.join(',')}]`;
  }
}
