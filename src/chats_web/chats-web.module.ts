import { Module } from '@nestjs/common';

import { ChatsModule } from '../chats/chats.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { ChatsWebController } from './chats-web.controller';
import { ChatsWebService } from './chats-web.service';

@Module({
  imports: [PrismaModule, ChatsModule, UploadModule],
  controllers: [ChatsWebController],
  providers: [ChatsWebService],
})
export class ChatsWebModule {}
