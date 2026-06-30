import { Injectable } from '@nestjs/common';
import { AdminAiReasoningLogsService } from '../ai-reasoning-logs/admin-ai-reasoning-logs.service';
import { AdminChatsService } from '../chats/admin-chats.service';
import { AdminReviewsService } from '../reviews/admin-reviews.service';

type AdminDangerousSession = Awaited<
  ReturnType<AdminChatsService['getChats']>
>[number];
type AdminReview = Awaited<
  ReturnType<AdminReviewsService['getReviews']>
>[number];
type AdminAiLog = Awaited<
  ReturnType<AdminAiReasoningLogsService['getLogs']>
>[number];

@Injectable()
export class AdminModerationService {
  constructor(
    private readonly adminChatsService: AdminChatsService,
    private readonly adminReviewsService: AdminReviewsService,
    private readonly adminAiReasoningLogsService: AdminAiReasoningLogsService,
  ) {}

  /** Chuẩn hóa ca nguy hiểm thành item trong hàng đợi moderation. */
  private mapDangerousSession(session: AdminDangerousSession) {
    return {
      id: `session-${session.id}`,
      type: 'dangerous-session' as const,
      title: `Ca nguy hiểm SE-${session.id}`,
      subtitle:
        session.user?.fullName?.trim() ||
        session.contactName?.trim() ||
        'Khách hàng',
      description:
        session.aiSummary?.trim() ||
        session.symptom?.trim() ||
        'Chưa có mô tả sự cố',
      severity: 'critical' as const,
      createdAt: session.updatedAt,
      metadata: {
        sessionId: session.id,
        status: session.status,
        address: session.address?.trim() || '--',
      },
    };
  }

  /** Chuẩn hóa review điểm thấp thành item cần admin kiểm tra lại chất lượng dịch vụ. */
  private mapNegativeReview(review: AdminReview) {
    return {
      id: `review-${review.id}`,
      type: 'negative-review' as const,
      title: `Đánh giá ${review.rating} sao cho ${review.technicianName}`,
      subtitle: review.customerName,
      description: review.comment || 'Khách hàng không để lại bình luận.',
      severity: 'warning' as const,
      createdAt: review.createdAt,
      metadata: {
        reviewId: review.id,
        sessionCode: review.sessionCode,
        technicianId: review.technicianId,
      },
    };
  }

  /** Chuẩn hóa log AI bị dislike thành item moderation để admin xem lại câu trả lời. */
  private mapDislikedAiLog(log: AdminAiLog) {
    return {
      id: `ai-${log.id}`,
      type: 'disliked-ai' as const,
      title: `Log AI #${log.id} bị đánh dấu cần xem lại`,
      subtitle: log.userName,
      description: log.aiResponse || log.userMsg,
      severity:
        log.riskLevel === 'CRITICAL' || log.riskLevel === 'HIGH'
          ? ('critical' as const)
          : ('warning' as const),
      createdAt: log.createdAt,
      metadata: {
        logId: log.id,
        sessionCode: log.sessionCode ?? '--',
        deviceCategory: log.deviceCategory ?? '--',
      },
    };
  }

  /** Tổng hợp hàng đợi moderation từ các nguồn dữ liệu admin đã có ở BE. */
  async getModerationQueue() {
    const [dangerousSessions, negativeReviews, dislikedAiLogs] =
      await Promise.all([
        this.adminChatsService.getChats({ isDangerous: 'true' }),
        this.adminReviewsService.getReviews({ sentiment: 'NEGATIVE' }),
        this.adminAiReasoningLogsService.getLogs({ feedback: 'DISLIKE' }),
      ]);

    const items = [
      ...dangerousSessions.map((item) => this.mapDangerousSession(item)),
      ...negativeReviews.map((item) => this.mapNegativeReview(item)),
      ...dislikedAiLogs.map((item) => this.mapDislikedAiLog(item)),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return {
      items,
      summary: {
        dangerousSessions: dangerousSessions.length,
        negativeReviews: negativeReviews.length,
        dislikedAiLogs: dislikedAiLogs.length,
      },
    };
  }
}
