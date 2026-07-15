import { Module } from '@nestjs/common';

import { RagModule } from '../../rag/rag.module';
import { AdminRagKnowledgeController } from './admin-rag-knowledge.controller';
import { AdminRagKnowledgeService } from './admin-rag-knowledge.service';

@Module({
  imports: [RagModule],
  controllers: [AdminRagKnowledgeController],
  providers: [AdminRagKnowledgeService],
  exports: [AdminRagKnowledgeService],
})
export class AdminRagKnowledgeModule { }