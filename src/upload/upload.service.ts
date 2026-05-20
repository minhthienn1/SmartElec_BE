import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor() {
    // Khởi tạo S3Client với cấu hình Cloudflare R2 từ .env
    this.s3Client = new S3Client({
      region: 'auto', // R2 luôn dùng 'auto'
      endpoint: process.env.R2_ENDPOINT as string,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });

    this.bucketName = process.env.R2_BUCKET_NAME as string;
    this.publicUrl = process.env.R2_PUBLIC_URL as string;
  }

  // ─────────────────────────────────────────────────────────────────
  // UPLOAD FILE LÊN CLOUDFLARE R2
  // - file: File từ Multer (req.file)
  // - folder: Thư mục trên R2 (VD: 'chat-images', 'avatars')
  // - Trả về URL công khai của file vừa upload
  // ─────────────────────────────────────────────────────────────────
  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    // Tạo tên file duy nhất: chat-images/1714300000000-photo.jpg
    const key = `${folder}/${Date.now()}-${file.originalname}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype, // Quan trọng: để trình duyệt/app đọc đúng loại file
      });

      await this.s3Client.send(command);

      // Ghép URL công khai hoàn chỉnh
      const publicFileUrl = `${this.publicUrl}/${key}`;

      console.log(`☁️ [R2] Upload thành công: ${publicFileUrl}`);
      return publicFileUrl;
    } catch (error : any) {
      console.error(`❌ [R2] Upload thất bại:`, error.message);
      throw new InternalServerErrorException(
        'Không thể upload file: ' + error.message,
      );
    }
  }

  // --- MỚI: DÀNH RIÊNG CHO CHAT (SỬ DỤNG UUID) ---
  async uploadMediaToR2(file: Express.Multer.File): Promise<string> {
    try {
      const uniqueFileName = `chats/${uuidv4()}${extname(file.originalname)}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: uniqueFileName,
          Body: file.buffer,
          ContentType: file.mimetype, // Giữ nguyên MIME type để không bị lỗi "loại file không hỗ trợ"
        }),
      );

      return `${this.publicUrl}/${uniqueFileName}`;
    } catch (error) {
      console.error('Lỗi upload file lên R2', error);
      throw new Error('Không thể tải tệp lên máy chủ');
    }
  }
}
