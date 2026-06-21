import { Module } from '@nestjs/common';
import { MechanicAiController } from './mechanic-ai.controller';
import { MechanicAiService } from './mechanic-ai.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [MechanicAiController],
  providers: [MechanicAiService],
  exports: [MechanicAiService],
})
export class MechanicAiModule {}
