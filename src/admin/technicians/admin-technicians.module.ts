import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminTechniciansController } from './admin-technicians.controller';
import { AdminTechniciansService } from './admin-technicians.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminTechniciansController],
  providers: [AdminTechniciansService],
})
export class AdminTechniciansModule {}
