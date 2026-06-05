import { Module } from '@nestjs/common';
import { AdminChatsModule } from '../chats/admin-chats.module';
import { AdminTechniciansModule } from '../technicians/admin-technicians.module';
import { AdminRepairSessionsController } from './admin-repair-sessions.controller';
import { AdminRepairSessionsService } from './admin-repair-sessions.service';

@Module({
  imports: [AdminChatsModule, AdminTechniciansModule],
  controllers: [AdminRepairSessionsController],
  providers: [AdminRepairSessionsService],
  exports: [AdminRepairSessionsService],
})
export class AdminRepairSessionsModule {}
