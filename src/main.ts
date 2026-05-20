import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Mở rộng giới hạn dung lượng để nhận được ảnh Base64 (AI Chat) - 10MB là đủ cho 1 tấm ảnh
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Bật Validation (DTO)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Đọc PORT từ .env, nếu không có thì mặc định chạy 3000
  const port = process.env.PORT || 3000;

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Server is running on: http://localhost:${port}`);
}
bootstrap();
