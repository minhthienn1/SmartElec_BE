import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminChatsController } from './admin-chats.controller';
import { AdminChatsService } from './admin-chats.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminChatsController],
  providers: [AdminChatsService],
  exports: [AdminChatsService],
})
export class AdminChatsModule {}
