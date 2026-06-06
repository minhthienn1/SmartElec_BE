import { Module } from '@nestjs/common';
import { AdminAccountsModule } from '../accounts/admin-accounts.module';
import { AdminAiReasoningLogsModule } from '../ai-reasoning-logs/admin-ai-reasoning-logs.module';
import { AdminChatsModule } from '../chats/admin-chats.module';
import { AdminTechniciansModule } from '../technicians/admin-technicians.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [
    AdminAccountsModule,
    AdminAiReasoningLogsModule,
    AdminChatsModule,
    AdminTechniciansModule,
  ],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
