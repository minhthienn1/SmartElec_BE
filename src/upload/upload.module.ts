import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService], // Export để ChatsModule có thể import dùng
})
export class UploadModule {}
