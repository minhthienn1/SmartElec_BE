import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AiRateLimitService {
    private readonly logger = new Logger(AiRateLimitService.name);
    private readonly lastRequestTime = new Map<number, number>();

    assertRateLimit(userId: number): void {
        const now = Date.now();
        const lastTime = this.lastRequestTime.get(userId) || 0;

        if (now - lastTime < 2000) {
            throw new HttpException(
                'Bạn đang thao tác quá nhanh, vui lòng đợi giây lát.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        this.lastRequestTime.set(userId, now);

        if (this.lastRequestTime.size > 10_000) {
            this.lastRequestTime.clear();
            this.logger.warn('Đã xóa Map rate-limit vì vượt 10k entries.');
        }
    }
}