import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { MechanicAiModule } from '../mechanic-ai/mechanic-ai.module';

@Module({
  imports: [PrismaModule, ConfigModule, MechanicAiModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
