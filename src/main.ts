import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  /**
   * Các origin mặc định được phép gọi backend.
   *
   * Có thể bổ sung thêm origin trong file .env:
   * CORS_ORIGINS=https://domain-1.com,https://domain-2.com
   */
  const defaultAllowedOrigins = [
    'https://smartelec.diennuoctruongtin.com',
    'https://smartelec-frontend.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];

  const originsFromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([
    ...defaultAllowedOrigins,
    ...originsFromEnv,
  ]);

  app.enableCors({
    origin: (origin, callback) => {
      /**
       * Request không có Origin thường đến từ:
       * - Postman
       * - Swagger
       * - curl
       * - Server gọi server
       */
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      console.warn(`[CORS] Từ chối origin không hợp lệ: ${origin}`);
      callback(null, false);
    },

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',

      /**
       * Header dùng để bỏ qua trang cảnh báo trung gian
       * của ngrok Free khi frontend gọi API.
       */
      'ngrok-skip-browser-warning',
    ],

    /**
     * Hệ thống đang xác thực bằng Bearer Token trong
     * Authorization nên hiện tại không cần cookie CORS.
     */
    credentials: false,

    /**
     * Cache kết quả preflight OPTIONS trong 24 giờ.
     */
    maxAge: 86400,

    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  /**
   * Cho phép nhận JSON và ảnh Base64 dung lượng lớn.
   */
  app.use(
    json({
      limit: '50mb',
    }),
  );

  app.use(
    urlencoded({
      extended: true,
      limit: '50mb',
    }),
  );

  /**
   * Tất cả API sẽ có tiền tố /api.
   *
   * Ví dụ:
   * /auth/login -> /api/auth/login
   */
  app.setGlobalPrefix('api');

  /**
   * Validation toàn hệ thống.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      /**
       * Chỉ giữ lại các thuộc tính đã khai báo trong DTO.
       */
      whitelist: true,

      /**
       * Báo lỗi nếu request gửi thêm thuộc tính không có trong DTO.
       */
      forbidNonWhitelisted: true,

      /**
       * Tự chuyển đổi dữ liệu request theo kiểu dữ liệu trong DTO.
       */
      transform: true,
    }),
  );

  const port = Number(process.env.PORT) || 3000;

  // --- Swagger / OpenAPI setup available at /swagger ---
  try {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SmartElec API')
      .setDescription('SmartElec backend API docs. Includes a small "Dev Review" endpoint that lists recently modified files.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'Authorization')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('swagger', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    console.log('Swagger UI available at: /swagger');
  } catch (err) {
    // Do not fail bootstrap when swagger setup fails for any reason
    console.warn('Không thể khởi tạo Swagger UI:', err);
  }

  await app.listen(port, '0.0.0.0');

  console.log(`Server đang chạy tại: http://localhost:${port}`);
}

void bootstrap();