import { Controller, Get, Post, Put, Body, Req, UseGuards } from '@nestjs/common';
import { TechnicianService } from './technician.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; 

@Controller('technicians') // Hạ cấp xuống 'technicians' để dùng chung cho cả profile, reviews, password
@UseGuards(JwtAuthGuard) 
export class TechnicianController {
  constructor(private readonly technicianService: TechnicianService) {}

  // Đổi thành 'jobs/completed' -> URL kết hợp sẽ là: /technicians/jobs/completed (Khớp chuẩn với FE)
  @Get('jobs/completed')
  async getCompletedJobs(@Req() req: any) {
    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub); 
    return this.technicianService.getCompletedJobs(technicianId);
  }

  // URL kết hợp: /technicians/profile (Khớp chuẩn với FE)
  @Get('profile')
  async getProfile(@Req() req: any) {
    console.log('--- API GET PROFILE ĐƯỢC GỌI TỪ FRONTEND ---');
    console.log('Dữ liệu req.user từ Token:', req.user);
    
    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    console.log('technicianId lấy ra được là:', technicianId);
    
    return this.technicianService.getProfile(technicianId);
  }

  // URL kết hợp: /technicians/reviews (Khớp chuẩn với FE)
  @Get('reviews')
  async getReviews(@Req() req: any) {
    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    return this.technicianService.getReviews(technicianId);
  }

  // URL kết hợp: /technicians/change-password (Khớp chuẩn với FE)
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: any) {
    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    return this.technicianService.changePassword(technicianId, body);
  }

  @Put('profile')
  async updateProfile(@Req() req: any, @Body() body: any) {
    console.log('--- API PUT UPDATE PROFILE ĐƯỢC GỌI ---');
    console.log('Dữ liệu cập nhật nhận được:', body);

    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub);
    return this.technicianService.updateProfile(technicianId, body);
  }
}