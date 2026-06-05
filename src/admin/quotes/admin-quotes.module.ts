import { Module } from '@nestjs/common';
import { AdminChatsModule } from '../chats/admin-chats.module';
import { AdminQuotesController } from './admin-quotes.controller';
import { AdminQuotesService } from './admin-quotes.service';

@Module({
  imports: [AdminChatsModule],
  controllers: [AdminQuotesController],
  providers: [AdminQuotesService],
})
export class AdminQuotesModule {}
