import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiIntentGateService } from './ai-intent-gate.service';

import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, ConfigModule, RagModule],
  controllers: [AiController],
  providers: [AiService, AiIntentGateService],
  exports: [AiService],
})
export class AiModule { }