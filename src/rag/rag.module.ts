import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UploadModule } from '../upload/upload.module';
import { RagController } from './rag.controller';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagFileParserService } from './rag-file-parser.service';
import { RagIngestionService } from './rag-ingestion.service';
import { RagRetrievalService } from './rag-retrieval.service';
import { RagImportProcessor } from './rag-import.processor';
import { RagService } from './rag.service';
import { RagTextCleanerService } from './rag-text-cleaner.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'rag-import-queue',
    }),
    UploadModule,
  ],
  controllers: [RagController],
  providers: [
    RagService,
    RagEmbeddingService,
    RagRetrievalService,
    RagFileParserService,
    RagTextCleanerService,
    RagChunkingService,
    RagIngestionService,
    RagImportProcessor,
  ],
  exports: [
    RagService,
    RagEmbeddingService,
    RagRetrievalService,
    RagIngestionService,
  ],
})
export class RagModule {}
