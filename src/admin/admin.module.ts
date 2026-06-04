import { Module } from '@nestjs/common';
import { AdminAccountsModule } from './accounts/admin-accounts.module';
import { AdminAiReasoningLogsModule } from './ai-reasoning-logs/admin-ai-reasoning-logs.module';
import { AdminChatsModule } from './chats/admin-chats.module';
import { AdminReviewsModule } from './reviews/admin-reviews.module';
import { AdminTechniciansModule } from './technicians/admin-technicians.module';

@Module({
  imports: [
    AdminAccountsModule,
    AdminAiReasoningLogsModule,
    AdminChatsModule,
    AdminReviewsModule,
    AdminTechniciansModule,
  ],
})
export class AdminModule {}
