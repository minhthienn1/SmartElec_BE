import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Bật CORS cho Flutter Web (Chrome)
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Mở rộng giới hạn dung lượng để nhận được ảnh Base64 (AI Chat) - 10MB là đủ cho 1 tấm ảnh
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  app.setGlobalPrefix('api'); // Thêm tiền tố 'api' cho tất cả các route

  // Bật Validation (DTO)
  app.useGlobalPipes(
    new ValidationPipe({
      // Chỉ giữ các field khai báo trong DTO.
      whitelist: true,
      // Báo lỗi ngay nếu payload chứa field lạ (chặn request nhảm).
      forbidNonWhitelisted: true,
      // Tự động transform kiểu dữ liệu theo DTO.
      transform: true,
    }),
  );

  // Đọc PORT từ .env, nếu không có thì mặc định chạy 3000
  const port = process.env.PORT || 3000;

  await app.listen(port, '0.0.0.0');
  console.log(`Server is running on: http://localhost:${port}`);
}
bootstrap();
