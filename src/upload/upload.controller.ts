import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  // ─────────────────────────────────────────────────────────────────
  // POST /upload/image
  // Upload ảnh lên Cloudflare R2 (dùng cho mọi nơi trong app)
  // Client gửi: multipart/form-data, field name = 'file'
  // ─────────────────────────────────────────────────────────────────
  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file. Vui lòng chọn ảnh để upload.');
    }

    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/x-matroska'
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Loại file không hỗ trợ (${file.mimetype}). Chỉ chấp nhận: Ảnh (JPEG, PNG, WebP, HEIC) và Video (MP4, MOV, MKV).`,
      );
    }

    // Giới hạn dung lượng: 50MB
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File quá lớn (${(file.size / 1024 / 1024).toFixed(1)}MB). Tối đa cho phép: 50MB.`,
      );
    }

    const url = await this.uploadService.uploadFile(file, 'media');

    return {
      message: 'Upload ảnh thành công!',
      url,
    };
  }
}
