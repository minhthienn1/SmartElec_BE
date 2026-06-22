import {
  Controller, Get, Patch, Post, Body, UseGuards, Req,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Gender } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 1. Lấy thông tin cá nhân (Hàm này cực kỳ quan trọng để load data)
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req) {
    // Trích xuất userId từ JWT Token
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    return this.usersService.findOne(userId);
  }

  @Patch('update-profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Req() req, @Body() updateData: any) {
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    return this.usersService.updateProfile(userId, updateData);
  }

  // 2. Cập nhật Token thông báo (FCM)
  @Patch('fcm-token')
  @UseGuards(JwtAuthGuard)
  async updateFcmToken(@Req() req, @Body('token') token: string) {
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    return this.usersService.updateFcmToken(userId, token);
  }

  // 3. Bật/Tắt trạng thái online (Dành cho thợ hoặc khách)
  @Patch('toggle-online')
  @UseGuards(JwtAuthGuard)
  async toggleOnline(
    @Req() req,
    @Body('latitude') latitude?: number,
    @Body('longitude') longitude?: number,
    @Body('isOnline') isOnline?: boolean,
  ) {
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    return this.usersService.toggleOnline(userId, latitude, longitude, isOnline);
  }

  // 4. Upload ảnh đại diện (nhận file nhị phân, lưu thẾ vào database)
  @Post('upload-avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(), // Giữ file trong RAM → dùng buffer trực tiếp
      limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn 5MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Chỉ cho phép upload file ảnh (jpeg, png, webp...)'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Không có file ảnh nào được gửi lên');
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    return this.usersService.uploadAvatar(userId, file.buffer);
  }

  // 5. Lấy ảnh đại diện hiện tại dưới dạng base64
  @Get('avatar')
  @UseGuards(JwtAuthGuard)
  async getAvatar(@Req() req) {
    const userId = Number(req.user.sub || req.user.userId || req.user.id);
    const base64 = await this.usersService.getAvatarBase64(userId);
    return { avatarBase64: base64 };
  }
}