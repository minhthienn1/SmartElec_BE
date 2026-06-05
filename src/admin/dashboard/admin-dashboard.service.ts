import { Injectable } from '@nestjs/common';
import { AdminAccountsService } from '../accounts/admin-accounts.service';
import { AdminAiReasoningLogsService } from '../ai-reasoning-logs/admin-ai-reasoning-logs.service';
import { AdminChatsService } from '../chats/admin-chats.service';
import { AdminTechniciansService } from '../technicians/admin-technicians.service';

type DashboardSession = NonNullable<
  Awaited<ReturnType<AdminChatsService['getChatById']>>
>;

type DashboardTechnician = Awaited<
  ReturnType<AdminTechniciansService['getTechnicians']>
>[number];

type AccountSummary = Awaited<
  ReturnType<AdminAccountsService['getAccounts']>
>['summary'];

const ACTIVE_JOB_STATUSES = ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly adminAccountsService: AdminAccountsService,
    private readonly adminAiReasoningLogsService: AdminAiReasoningLogsService,
    private readonly adminChatsService: AdminChatsService,
    private readonly adminTechniciansService: AdminTechniciansService,
  ) {}

  /** Ép metadata của message về object để đọc các trường quote trong dashboard an toàn hơn. */
  private asMetadata(metadata: unknown) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as Record<string, unknown>;
    }

    return {};
  }

  /** Chuẩn hóa trạng thái job backend về tập trạng thái mà dashboard đang hiển thị. */
  private toDashboardStatus(status: DashboardSession['status']) {
    return status === 'DONE' ? 'COMPLETED' : status;
  }

  /** Đếm số phần tử theo khóa string rồi trả về danh sách top giảm dần. */
  private buildTopInsights(values: Array<string | null | undefined>, limit = 10) {
    const counter = new Map<string, number>();

    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .forEach((value) => {
        counter.set(value, (counter.get(value) ?? 0) + 1);
      });

    return Array.from(counter.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([name, value]) => ({ name, value }));
  }

  /** Chuyển timestamp ISO sang chuỗi thời gian tương đối để hiển thị trên timeline. */
  private formatRelativeTime(value: string) {
    const diffMs = Date.now() - new Date(value).getTime();
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

    if (diffMinutes < 60) {
      return `${diffMinutes} phút trước`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} giờ trước`;
    }

    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} ngày trước`;
  }

  /** Suy ra mức độ ưu tiên hiển thị cho job từ trạng thái và cờ nguy hiểm. */
  private getSeverity(session: DashboardSession) {
    if (session.isDangerous) return 'Nguy hiểm';
    if (session.status === 'BROADCASTING') return 'Cao';
    if (ACTIVE_JOB_STATUSES.includes(session.status as (typeof ACTIVE_JOB_STATUSES)[number])) {
      return 'Trung bình';
    }
    return 'Thấp';
  }

  /** Lấy amount của các quote đã được chấp nhận trong metadata message. */
  private getAcceptedQuoteAmount(message: NonNullable<DashboardSession['messages']>[number]) {
    const metadata = this.asMetadata(message.metadata);
    const quoteStatus = metadata.quoteStatus;
    const amount = Number(metadata.amount);

    if (quoteStatus === 'ACCEPTED' && Number.isFinite(amount)) {
      return amount;
    }

    return 0;
  }

  /** Gom dữ liệu job và doanh thu theo 7 ngày gần nhất để dựng biểu đồ dashboard. */
  private buildRevenueSeries(sessions: DashboardSession[]) {
    const today = new Date();
    const buckets = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);

      return {
        key,
        label: new Intl.DateTimeFormat('vi-VN', {
          day: '2-digit',
          month: '2-digit',
        }).format(date),
        jobs: 0,
        revenue: 0,
      };
    });

    const bucketMap = new Map(buckets.map((item) => [item.key, item]));

    sessions.forEach((session) => {
      const createdKey = session.createdAt.slice(0, 10);
      const bucket = bucketMap.get(createdKey);

      if (bucket) {
        bucket.jobs += 1;
      }

      (session.messages ?? []).forEach((message) => {
        const revenueBucket = bucketMap.get(message.createdAt.slice(0, 10));
        if (revenueBucket) {
          revenueBucket.revenue += this.getAcceptedQuoteAmount(message);
        }
      });
    });

    return buckets.map((item) => ({
      date: item.label,
      jobs: item.jobs,
      revenue: item.revenue,
    }));
  }

  /** Tạo timeline hoạt động gần đây từ các phiên chat thật của hệ thống. */
  private buildRecentActivities(sessions: DashboardSession[]) {
    return sessions
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 6)
      .map((session) => {
        const quoteAccepted = (session.messages ?? []).some(
          (message) => this.asMetadata(message.metadata).quoteStatus === 'ACCEPTED',
        );

        if (quoteAccepted) {
          return {
            id: `quote-${session.id}`,
            time: this.formatRelativeTime(session.updatedAt),
            title: `Báo giá của đơn #SE-${session.id} đã được chấp nhận`,
            detail:
              session.symptom?.trim() ||
              session.aiSummary?.trim() ||
              'Có cập nhật báo giá mới.',
            type: 'quote' as const,
          };
        }

        if (session.status === 'COMPLETED' || session.status === 'DONE') {
          return {
            id: `complete-${session.id}`,
            time: this.formatRelativeTime(session.updatedAt),
            title: `Đơn #SE-${session.id} đã hoàn thành`,
            detail:
              session.symptom?.trim() ||
              session.aiSummary?.trim() ||
              'Ca sửa chữa vừa được đóng.',
            type: 'complete' as const,
          };
        }

        if (session.technician?.fullName?.trim()) {
          return {
            id: `tech-${session.id}`,
            time: this.formatRelativeTime(session.updatedAt),
            title: `Thợ ${session.technician.fullName.trim()} đang xử lý đơn #SE-${session.id}`,
            detail:
              session.address?.trim() ||
              session.symptom?.trim() ||
              'Đơn đã được gán thợ.',
            type: 'technician' as const,
          };
        }

        if (session.status === 'AI_CONSULTING') {
          return {
            id: `ai-${session.id}`,
            time: this.formatRelativeTime(session.updatedAt),
            title: `Phiên AI #SE-${session.id} vừa được cập nhật`,
            detail:
              session.aiSummary?.trim() ||
              session.symptom?.trim() ||
              'Khách hàng đang tư vấn với AI.',
            type: 'ai' as const,
          };
        }

        return {
          id: `job-${session.id}`,
          time: this.formatRelativeTime(session.updatedAt),
          title: `Khách tạo đơn #SE-${session.id}`,
          detail:
            session.symptom?.trim() ||
            session.aiSummary?.trim() ||
            'Phiên sửa chữa mới được tạo.',
          type: 'job' as const,
        };
      });
  }

  /** Đổi technician admin sang row dashboard để hiển thị nhóm thợ đang online. */
  private mapOnlineTechnician(item: DashboardTechnician) {
    const expertise =
      item.currentJob?.deviceType?.trim() || item.address?.trim() || 'Điện gia dụng';

    return {
      id: item.id,
      name: item.fullName || `Thợ #${item.id}`,
      expertise,
      activeJobs: item.activeJobCount,
      rating: item.averageRating,
      status:
        item.activeJobCount >= 3
          ? 'Sắp bận'
          : item.activeJobCount >= 1
            ? 'Đang xử lý'
            : 'Rảnh',
    };
  }

  /** Tạo danh sách đơn ưu tiên từ các phiên chat đang chờ xử lý hoặc có rủi ro cao. */
  private buildUrgentJobs(
    sessions: DashboardSession[],
    technicians: DashboardTechnician[],
  ) {
    const technicianMap = new Map(technicians.map((item) => [Number(item.id), item]));

    return sessions
      .filter(
        (session) =>
          session.isDangerous ||
          session.status === 'BROADCASTING' ||
          ACTIVE_JOB_STATUSES.includes(
            session.status as (typeof ACTIVE_JOB_STATUSES)[number],
          ),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8)
      .map((session) => {
        const technician =
          session.technicianId != null
            ? technicianMap.get(session.technicianId)
            : undefined;

        return {
          id: `#SE-${session.id}`,
          device: session.deviceType?.trim() || 'Chưa rõ thiết bị',
          issue:
            session.symptom?.trim() ||
            session.aiSummary?.trim() ||
            'Chưa có mô tả sự cố',
          status: this.toDashboardStatus(session.status),
          severity: this.getSeverity(session),
          customerName:
            session.user?.fullName?.trim() ||
            session.contactName?.trim() ||
            'Khách hàng',
          description: session.aiSummary?.trim() || session.symptom?.trim() || undefined,
          assignedTechnician:
            session.technician?.fullName?.trim() || technician?.fullName || undefined,
          technicianPhone: technician?.phoneNumber,
          address: session.address?.trim() || undefined,
        };
      });
  }

  /** Xây overview và KPI chính cho dashboard từ các nguồn BE hiện có. */
  private buildOverview(
    totalAccounts: number,
    accountSummary: AccountSummary,
    technicians: DashboardTechnician[],
    sessions: DashboardSession[],
  ) {
    const onlineTechnicians = technicians.filter(
      (item) => item.isOnline && item.isActive,
    ).length;
    const broadcastingJobs = sessions.filter(
      (item) => item.status === 'BROADCASTING',
    ).length;
    const completedJobs = sessions.filter((item) =>
      ['COMPLETED', 'DONE'].includes(item.status),
    ).length;
    const inProgressJobs = sessions.filter((item) =>
      ACTIVE_JOB_STATUSES.includes(item.status as (typeof ACTIVE_JOB_STATUSES)[number]),
    ).length;
    const dangerousJobs = sessions.filter((item) => item.isDangerous).length;
    const alerts =
      dangerousJobs + sessions.filter((item) => item.status === 'CANCELLED').length;

    const health =
      dangerousJobs >= 3 ? 'critical' : alerts >= 2 ? 'warning' : 'stable';

    return {
      health,
      onlineTechnicians,
      broadcastingJobs,
      alerts,
      kpis: [
        {
          key: 'accounts-total',
          label: 'Tổng tài khoản',
          value: String(totalAccounts),
          hint: `${accountSummary.customers} khách • ${accountSummary.technicians} thợ • ${accountSummary.admins} admin`,
          badge: 'Toàn hệ thống',
          href: '/admin/accounts',
          tone: 'info',
          icon: 'jobs',
        },
        {
          key: 'broadcasting',
          label: 'Đang tìm thợ',
          value: String(broadcastingJobs),
          hint: `${dangerousJobs} ca nguy hiểm cần ưu tiên`,
          badge: dangerousJobs > 0 ? 'Cần xử lý' : 'Ổn định',
          href: '/admin/chats?status=BROADCASTING',
          tone: dangerousJobs > 0 ? 'warn' : 'info',
          icon: 'broadcast',
        },
        {
          key: 'in-progress',
          label: 'Đang sửa',
          value: String(inProgressJobs),
          hint: 'Các ca đã có thợ nhận hoặc đang thực hiện',
          badge: 'Theo dõi',
          href: '/admin/chats',
          tone: 'info',
          icon: 'repair',
        },
        {
          key: 'completed',
          label: 'Hoàn thành',
          value: String(completedJobs),
          hint: 'Số phiên đã đóng trong dữ liệu hiện có',
          badge: 'Đã xử lý',
          href: '/admin/chats?status=COMPLETED',
          tone: 'good',
          icon: 'done',
        },
        {
          key: 'verified',
          label: 'Đã xác minh',
          value: String(accountSummary.verified),
          hint: `${accountSummary.unverified} tài khoản chưa xác minh`,
          badge: accountSummary.unverified > 0 ? 'Cần kiểm tra' : 'Ổn định',
          href: '/admin/accounts?verified=VERIFIED',
          tone: accountSummary.unverified > 0 ? 'warn' : 'good',
          icon: 'money',
        },
        {
          key: 'tech-online',
          label: 'Thợ online',
          value: String(onlineTechnicians),
          hint: `${technicians.filter((item) => item.activeJobCount === 0 && item.isOnline).length} thợ đang rảnh`,
          badge: 'Realtime',
          href: '/admin/technicians',
          tone: 'info',
          icon: 'tech',
        },
      ],
    };
  }

  /** Lấy đầy đủ chi tiết session để dashboard có message, quote và timeline thật. */
  private async getDetailedSessions() {
    const sessions = await this.adminChatsService.getChats({});
    const details = await Promise.all(
      sessions.map((session) => this.adminChatsService.getChatById(session.id)),
    );

    return details.filter((item): item is DashboardSession => item != null);
  }

  /** Tổng hợp dữ liệu dashboard từ các route admin hiện có thành resource riêng. */
  async getDashboardData() {
    const [accountsResult, technicians, sessionDetails, aiLogs] = await Promise.all([
      this.adminAccountsService.getAccounts({ page: '1', pageSize: '10' }),
      this.adminTechniciansService.getTechnicians(),
      this.getDetailedSessions(),
      this.adminAiReasoningLogsService.getLogs({}),
    ]);

    const overview = this.buildOverview(
      accountsResult.summary.total,
      accountsResult.summary,
      technicians,
      sessionDetails,
    );

    const jobsByStatus = [
      'AI_CONSULTING',
      'BROADCASTING',
      'MATCHED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ].map((status) => ({
      status,
      count: sessionDetails.filter((item) => item.status === status).length,
    }));

    const dislikes = aiLogs.filter((item) => item.aiFeedback === 'DISLIKE');
    const likes = aiLogs.filter((item) => item.aiFeedback === 'LIKE');

    return {
      overview,
      jobsByStatus,
      revenueSeries: this.buildRevenueSeries(sessionDetails),
      urgentJobs: this.buildUrgentJobs(sessionDetails, technicians),
      onlineTechnicians: technicians
        .filter((item) => item.isOnline && item.isActive)
        .map((item) => this.mapOnlineTechnician(item)),
      topAiDevices: this.buildTopInsights(
        sessionDetails
          .filter((item) => item.status === 'AI_CONSULTING')
          .map((item) => item.deviceType),
      ),
      topRepairDevices: this.buildTopInsights(
        sessionDetails
          .filter((item) => item.status !== 'AI_CONSULTING')
          .map((item) => item.deviceType),
      ),
      aiQuality: {
        likes: likes.length,
        dislikes: dislikes.length,
        recentDislikes: dislikes.slice(0, 5).map((item) => item.userMsg),
      },
      recentActivities: this.buildRecentActivities(sessionDetails),
    };
  }
}
