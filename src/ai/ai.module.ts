import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiIntentGateService } from './ai-intent-gate.service';
import { AiGuidedDiagnosisService } from './ai-guided-diagnosis.service';
import { AiResponseBuilderService } from './ai-response-builder.service';
import { AiConversationPersistenceService } from './ai-conversation-persistence.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiGeminiService } from './ai-gemini.service';
import { AiStructuredExtractorService } from './ai-structured-extractor.service';

import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, ConfigModule, RagModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiIntentGateService,
    AiGuidedDiagnosisService,
    AiResponseBuilderService,
    AiConversationPersistenceService,
    AiRateLimitService,
    AiGeminiService,
    AiStructuredExtractorService,
  ],
  exports: [AiService],
})
export class AiModule { }
