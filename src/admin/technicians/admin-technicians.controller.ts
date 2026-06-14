import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminTechniciansService } from './admin-technicians.service';

@UseGuards(JwtAuthGuard)
@Controller('admin/technicians')
export class AdminTechniciansController {
  constructor(
    private readonly adminTechniciansService: AdminTechniciansService,
  ) {}

  @Get()
  getTechnicians() {
    return this.adminTechniciansService.getTechnicians();
  }
}
