import { Module } from '@nestjs/common';
import { MechanicAiController } from './mechanic-ai.controller';
import { MechanicAiService } from './mechanic-ai.service';

@Module({
  controllers: [MechanicAiController],
  providers: [MechanicAiService],
  exports: [MechanicAiService],
})
export class MechanicAiModule {}
