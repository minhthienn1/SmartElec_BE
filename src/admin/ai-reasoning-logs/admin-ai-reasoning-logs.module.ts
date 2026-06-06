import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAiReasoningLogsController } from './admin-ai-reasoning-logs.controller';
import { AdminAiReasoningLogsService } from './admin-ai-reasoning-logs.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAiReasoningLogsController],
  providers: [AdminAiReasoningLogsService],
  exports: [AdminAiReasoningLogsService],
})
export class AdminAiReasoningLogsModule {}
