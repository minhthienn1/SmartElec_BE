import { Module } from '@nestjs/common';
import { AdminAiReasoningLogsModule } from '../ai-reasoning-logs/admin-ai-reasoning-logs.module';
import { AdminChatsModule } from '../chats/admin-chats.module';
import { AdminReviewsModule } from '../reviews/admin-reviews.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';

@Module({
  imports: [AdminAiReasoningLogsModule, AdminChatsModule, AdminReviewsModule],
  controllers: [AdminModerationController],
  providers: [AdminModerationService],
})
export class AdminModerationModule {}
