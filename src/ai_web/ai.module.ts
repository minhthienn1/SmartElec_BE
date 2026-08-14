import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { AiContextCollectorService } from './extraction/ai-context-collector.service';
import { AiIntentGateService } from './extraction/ai-intent-gate.service';
import { AiStructuredExtractorService } from './extraction/ai-structured-extractor.service';
import { AiGeminiService } from './generation/ai-gemini.service';
import { AiResponseBuilderService } from './generation/ai-response-builder.service';
import { AiGuidedDiagnosisService } from './orchestration/ai-guided-diagnosis.service';
import { AiSessionContextService } from './orchestration/ai-session-context.service';
import { AiConversationPersistenceService } from './persistence/ai-conversation-persistence.service';
import { AiRelatedHistoryService } from './persistence/ai-related-history.service';
import { AiQuestionPolicyService } from './policies/ai-question-policy.service';
import { AiRagPolicyService } from './policies/ai-rag-policy.service';
import { AiRateLimitService } from './policies/ai-rate-limit.service';
import { AiSafetyPolicyService } from './policies/ai-safety-policy.service';
import { AiWebDeviceCatalogService } from './policies/ai-web-device-catalog.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

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
    AiWebDeviceCatalogService,
    AiContextCollectorService,
    AiQuestionPolicyService,
    AiSafetyPolicyService,
    AiRagPolicyService,
    AiSessionContextService,
  ],
  exports: [AiService],
})
export class AiWebModule {}
