import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { AiConversationPersistenceService } from './ai-conversation-persistence.service';
import { AiController } from './ai.controller';
import { AiGeminiService } from './ai-gemini.service';
import { AiGuidedDiagnosisService } from './ai-guided-diagnosis.service';
import { AiIntentGateService } from './ai-intent-gate.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiRelatedHistoryService } from './ai-related-history.service';
import { AiResponseBuilderService } from './ai-response-builder.service';
import { AiService } from './ai.service';
import { AiStructuredExtractorService } from './ai-structured-extractor.service';

@Module({
  imports: [PrismaModule, ConfigModule, RagModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiIntentGateService,
    AiGuidedDiagnosisService,
    AiResponseBuilderService,
    AiConversationPersistenceService,
    AiRelatedHistoryService,
    AiRateLimitService,
    AiGeminiService,
    AiStructuredExtractorService,
  ],
  exports: [AiService],
})
export class AiWebModule {}
