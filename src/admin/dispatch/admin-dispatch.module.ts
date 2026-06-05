import { Module } from '@nestjs/common';
import { AdminChatsModule } from '../chats/admin-chats.module';
import { AdminRepairSessionsModule } from '../repair-sessions/admin-repair-sessions.module';
import { AdminTechniciansModule } from '../technicians/admin-technicians.module';
import { AdminDispatchController } from './admin-dispatch.controller';
import { AdminDispatchService } from './admin-dispatch.service';

@Module({
  imports: [AdminChatsModule, AdminRepairSessionsModule, AdminTechniciansModule],
  controllers: [AdminDispatchController],
  providers: [AdminDispatchService],
})
export class AdminDispatchModule {}
