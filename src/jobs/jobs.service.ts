import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class JobsService {
  constructor(
    @InjectQueue('job-dispatch-queue') private readonly dispatchQueue: Queue,
  ) {}

  async addJobDispatch(sessionId: number, attempt: number = 1, delay: number = 0) {
    await this.dispatchQueue.add(
      'dispatch',
      { sessionId, attempt },
      { delay },
    );
  }
}
