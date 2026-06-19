import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagRetrievalService } from './rag-retrieval.service';

@Module({
  controllers: [RagController],
  providers: [RagService, RagEmbeddingService, RagRetrievalService],
  exports: [RagService, RagEmbeddingService, RagRetrievalService],
})
export class RagModule {}
