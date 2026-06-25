import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { RAG_LIMITS } from './rag.constants';

const GEMINI_EMBEDDING_RATE_LIMIT_MESSAGE =
  'Đã vượt giới hạn Gemini Embedding. Vui lòng thử lại sau hoặc giảm số lượng chunk import.';

@Injectable()
export class RagEmbeddingService {
  private readonly logger = new Logger(RagEmbeddingService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly embeddingModel: GenerativeModel;
  private embeddingQueue: Promise<void> = Promise.resolve();
  private lastEmbeddingAt = 0;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: 'gemini-embedding-001',
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createGeminiRateLimitException() {
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: GEMINI_EMBEDDING_RATE_LIMIT_MESSAGE,
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private isGeminiQuotaError(error: unknown) {
    if (typeof error === 'string') {
      const message = error.toLowerCase();

      return (
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('rate-limits')
      );
    }

    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as {
      status?: number;
      statusText?: string;
      message?: string;
    };

    const message = candidate.message?.toLowerCase() || '';
    const statusText = candidate.statusText?.toLowerCase() || '';

    return (
      candidate.status === HttpStatus.TOO_MANY_REQUESTS ||
      statusText.includes('too many requests') ||
      message.includes('429') ||
      message.includes('too many requests') ||
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('rate-limits')
    );
  }

  private async waitForNextEmbeddingSlot() {
    const waitMs = Math.max(
      0,
      this.lastEmbeddingAt + RAG_LIMITS.EMBEDDING_MIN_INTERVAL_MS - Date.now(),
    );

    if (waitMs > 0) {
      await this.sleep(waitMs);
    }

    this.lastEmbeddingAt = Date.now();
  }

  private async enqueueEmbedding<T>(worker: () => Promise<T>): Promise<T> {
    const run = this.embeddingQueue.then(worker, worker);

    this.embeddingQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.enqueueEmbedding(async () => {
      const retryDelays = RAG_LIMITS.EMBEDDING_RETRY_DELAYS_MS;

      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
          await this.waitForNextEmbeddingSlot();

          const result = await this.embeddingModel.embedContent({
            content: { parts: [{ text }], role: 'user' },
            // @ts-ignore SDK cũ có thể chưa khai báo field này nhưng API vẫn hỗ trợ.
            outputDimensionality: 768,
          });

          const values = result.embedding?.values;

          if (!Array.isArray(values) || values.length === 0) {
            this.logger.error('Gemini trả về embedding rỗng');

            throw new InternalServerErrorException(
              'Gemini không trả về vector embedding hợp lệ',
            );
          }

          return values;
        } catch (error) {
          if (error instanceof HttpException) {
            throw error;
          }

          if (this.isGeminiQuotaError(error)) {
            const retryDelay = retryDelays[attempt];

            this.logger.warn(
              `Gemini embedding bị giới hạn quota/rate limit ở lần thử ${attempt + 1}.`,
            );

            if (retryDelay !== undefined) {
              await this.sleep(retryDelay);
              continue;
            }

            throw this.createGeminiRateLimitException();
          }

          this.logger.error('Lỗi khi tạo embedding cho RAG', error);

          throw new InternalServerErrorException(
            'Không thể tạo embedding cho dữ liệu RAG',
          );
        }
      }

      throw this.createGeminiRateLimitException();
    });
  }

  toPgVector(values: number[]): string {
    if (!Array.isArray(values) || values.length === 0) {
      this.logger.error('Embedding rỗng, không thể chuyển sang pgvector');

      throw new InternalServerErrorException('Embedding không hợp lệ');
    }

    return `[${values.join(',')}]`;
  }
}