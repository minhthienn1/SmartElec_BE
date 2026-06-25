import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { RagIngestionService } from './rag-ingestion.service';

@Processor('rag-import-queue')
export class RagImportProcessor extends WorkerHost {
  private readonly logger = new Logger(RagImportProcessor.name);

  constructor(private readonly ragIngestionService: RagIngestionService) {
    super();
  }

  async process(job: Job<{ documentId: number }, void, string>): Promise<void> {
    const { documentId } = job.data;

    this.logger.log(`Nhận job import RAG documentId=${documentId}`);

    await this.ragIngestionService.processImportedDocument(documentId);
  }
}
