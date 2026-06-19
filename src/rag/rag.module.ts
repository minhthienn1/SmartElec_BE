import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { RagController } from './rag.controller';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagFileParserService } from './rag-file-parser.service';
import { RagIngestionService } from './rag-ingestion.service';
import { RagRetrievalService } from './rag-retrieval.service';
import { RagService } from './rag.service';
import { RagTextCleanerService } from './rag-text-cleaner.service';

@Module({
  imports: [UploadModule],
  controllers: [RagController],
  providers: [
    RagService,
    RagEmbeddingService,
    RagRetrievalService,
    RagFileParserService,
    RagTextCleanerService,
    RagChunkingService,
    RagIngestionService,
  ],
  exports: [
    RagService,
    RagEmbeddingService,
    RagRetrievalService,
    RagIngestionService,
  ],
})
export class RagModule {}
