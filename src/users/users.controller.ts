import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Gender } from '@prisma/client';

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
}