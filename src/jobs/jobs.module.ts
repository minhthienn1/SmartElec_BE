import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { JobDispatchProcessor } from './job-dispatch.processor';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'job-dispatch-queue',
    }),
    NotificationsModule,
  ],
  providers: [JobsService, JobDispatchProcessor],
  exports: [JobsService],
})
export class JobsModule {}
