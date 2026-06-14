import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ZaloLoginDto } from './dto/zalo-login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { RequestResetOtpDto } from './dto/request-reset-otp.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth') // Đường dẫn gốc là /auth
export class AuthController {
  constructor(private authService: AuthService) {}

  private getRequestUserId(req: Request & { user: { userId: number } }) {
    return req.user.userId;
  }

  @Post('register') // Đường dẫn cụ thể là /auth/register
  async register(@Body() body: RegisterDto) {
    // Đảm bảo dùng RegisterDto ở đây
    // Truyền nguyên cái body (DTO) vào service
    return this.authService.register(body);
  }
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.phoneNumber, loginDto.password);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: Request & { user: { userId: number } }) {
    return this.authService.getProfile(this.getRequestUserId(req));
  }

  @Post('zalo-login')
  async zaloLogin(@Body() zaloLoginDto: ZaloLoginDto) {
    return this.authService.loginWithZalo(zaloLoginDto);
  }

  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  async setPassword(
    @Req() req: Request & { user: { userId: number } },
    @Body() setPasswordDto: SetPasswordDto,
  ) {
    return this.authService.setPasswordForZaloUser(
      this.getRequestUserId(req),
      setPasswordDto,
    );
  }

  @Post('google-login')
  async googleLogin(@Body() googleLoginDto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(googleLoginDto);
  }

  @Post('forgot-password/request-otp')
  async requestResetOtp(@Body() requestResetOtpDto: RequestResetOtpDto) {
    return this.authService.requestResetOtp(requestResetOtpDto);
  }

  @Post('forgot-password/verify-otp')
  async verifyResetOtp(@Body() verifyResetOtpDto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(verifyResetOtpDto);
  }

  @Post('forgot-password/reset')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }
}
