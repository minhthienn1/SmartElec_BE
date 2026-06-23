import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TechnicianService } from './technician.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; 

@Controller('technicians/jobs') // Đổi tiền tố để tách biệt hoàn toàn
@UseGuards(JwtAuthGuard) 
export class TechnicianController {
  constructor(private readonly technicianService: TechnicianService) {}

  @Get('completed')
  async getCompletedJobs(@Req() req: any) {
    // Bắt ID an toàn cho mọi loại token
    const technicianId = Number(req.user?.id || req.user?.userId || req.user?.sub); 
    
    return this.technicianService.getCompletedJobs(technicianId);
  }
}