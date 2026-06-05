import { Module } from '@nestjs/common';
import { AdminAccountsModule } from './accounts/admin-accounts.module';
import { AdminAiReasoningLogsModule } from './ai-reasoning-logs/admin-ai-reasoning-logs.module';
import { AdminChatsModule } from './chats/admin-chats.module';
import { AdminDashboardModule } from './dashboard/admin-dashboard.module';
import { AdminDispatchModule } from './dispatch/admin-dispatch.module';
import { AdminModerationModule } from './moderation/admin-moderation.module';
import { AdminQuotesModule } from './quotes/admin-quotes.module';
import { AdminRepairSessionsModule } from './repair-sessions/admin-repair-sessions.module';
import { AdminReviewsModule } from './reviews/admin-reviews.module';
import { AdminTechniciansModule } from './technicians/admin-technicians.module';

@Module({
  imports: [
    AdminAccountsModule,
    AdminAiReasoningLogsModule,
    AdminChatsModule,
    AdminDashboardModule,
    AdminDispatchModule,
    AdminModerationModule,
    AdminQuotesModule,
    AdminRepairSessionsModule,
    AdminReviewsModule,
    AdminTechniciansModule,
  ],
})
export class AdminModule {}
