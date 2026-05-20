import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth') // Đường dẫn gốc là /auth
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register') // Đường dẫn cụ thể là /auth/register
  async register(@Body() body: RegisterDto) { // Đảm bảo dùng RegisterDto ở đây
  // Truyền nguyên cái body (DTO) vào service
  return this.authService.register(body); 
}
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.phoneNumber, loginDto.password);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req) {
    return this.authService.getProfile(req.user.userId);
  }
}
