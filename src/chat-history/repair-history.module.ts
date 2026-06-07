import { Module } from '@nestjs/common';
import { RepairHistoryController } from './repair-history.controller';
import { RepairHistoryService } from './repair-history.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RepairHistoryController],
  providers: [RepairHistoryService],
})
export class RepairHistoryModule {}