import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminReviewsService } from './admin-reviews.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminReviewsController],
  providers: [AdminReviewsService],
})
export class AdminReviewsModule {}
