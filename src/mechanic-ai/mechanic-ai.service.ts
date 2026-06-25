import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { IngestDocumentDto } from '../rag/dto/ingest-document.dto';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import { RagService } from '../rag/rag.service';

@Injectable()
export class MechanicAiService {
  private readonly logger = new Logger(MechanicAiService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly ragRetrievalService: RagRetrievalService,
  ) {}

  // Legacy endpoint `/mechanic-ai/ingest`: giữ route cũ nhưng lưu bằng schema RAG mới.
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

    const result = await this.ragService.ingestDocument({
      title,
      content,
      category: category || undefined,
      source: source || undefined,
      accessLevel,
    } as IngestDocumentDto);

    this.logger.log(`Legacy ingest route da duoc proxy sang RagService: "${title}"`);
    return {
      message: result.message,
      data: result.document,
    };
  }

  // Legacy retrieval route `/mechanic-ai/search`: giữ route cũ nhưng search trên rag_chunks.
  async findRelevantDocs(
    query: string,
    accessLevel: 'BASIC' | 'ADVANCED',
    limit: number = 3,
  ) {
    return this.ragRetrievalService.findRelevantChunks({
      query,
      accessLevel,
      limit,
    });
  }
}
