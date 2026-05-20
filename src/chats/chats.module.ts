import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatController } from './chat.controller';
import { ChatsService } from './chats.service';
import { ChatsGateway } from './chats.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [PrismaModule, UploadModule, NotificationsModule, JobsModule],
  controllers: [ChatsController, ChatController],
  providers: [ChatsService, ChatsGateway],
  exports: [ChatsService],
})
export class ChatsModule {}


