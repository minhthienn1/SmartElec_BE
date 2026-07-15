import { Injectable } from '@nestjs/common';
import { AdminChatsService } from '../chats/admin-chats.service';
import { AdminTechniciansService } from '../technicians/admin-technicians.service';

type AdminChatSession = NonNullable<
  Awaited<ReturnType<AdminChatsService['getChatById']>>
>;

type AdminTechnician = Awaited<
  ReturnType<AdminTechniciansService['getTechnicians']>
>[number];

@Injectable()
export class AdminRepairSessionsService {
  constructor(
    private readonly adminChatsService: AdminChatsService,
    private readonly adminTechniciansService: AdminTechniciansService,
  ) {}

  /** Chuẩn hóa kỹ thuật viên admin sang shape mà màn repair session đang tiêu thụ. */
  private mapTechnician(technician?: AdminTechnician | null) {
    if (!technician) return null;

    return {
      id: technician.id,
      fullName: technician.fullName,
      phoneNumber: technician.phoneNumber,
      avatarUrl: technician.avatarUrl,
      isOnline: technician.isOnline,
      latitude: technician.latitude,
      longitude: technician.longitude,
      averageRating: technician.averageRating,
      totalReviews: technician.totalReviews,
      isActive: technician.isActive,
      isVerified: technician.isVerified,
      distanceKm: 0,
      currentWorkload: technician.activeJobCount,
    };
  }

  /** Dựng lịch sử gán thợ từ assignment histories thật để FE không còn tự đoán dữ liệu. */
  private buildAssignmentHistory(
    session: AdminChatSession,
    technicianName?: string | null,
  ) {
    if (
      Array.isArray(session.assignmentHistories) &&
      session.assignmentHistories.length > 0
    ) {
      return session.assignmentHistories.map((item) => ({
        id: String(item.id),
        chatSessionId: String(session.id),
        technicianId: String(item.technicianId),
        technicianName:
          item.technician?.fullName?.trim() || technicianName || undefined,
        action: item.action,
        reason: undefined,
        createdAt: item.createdAt,
      }));
    }

    if (session.technicianId != null) {
      return [
        {
          id: `hist-assigned-${session.id}`,
          chatSessionId: String(session.id),
          technicianId: String(session.technicianId),
          technicianName: technicianName ?? undefined,
          action: 'ASSIGNED' as const,
          reason: 'Ca đã có kỹ thuật viên phụ trách.',
          createdAt: session.updatedAt,
        },
      ];
    }

    return [];
  }

  /** Tạo timeline trạng thái tối thiểu để màn admin hiển thị tiến trình ca sửa chữa. */
  private buildStatusTimeline(session: AdminChatSession) {
    const items: Array<{
      id: string;
      status: AdminChatSession['status'];
      title: string;
      description?: string;
      createdAt: string;
    }> = [
      {
        id: `created-${session.id}`,
        status: 'AI_CONSULTING',
        title: 'Khởi tạo ca',
        description: 'Khách hàng bắt đầu phiên tư vấn/sửa chữa.',
        createdAt: session.createdAt,
      },
    ];

    if (session.status !== 'AI_CONSULTING') {
      items.push({
        id: `status-${session.id}-${session.status}`,
        status: session.status,
        title: `Chuyển trạng thái ${session.status}`,
        description:
          session.aiSummary?.trim() || session.symptom?.trim() || undefined,
        createdAt: session.updatedAt,
      });
    }

    return items.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  /** Chuẩn hóa session BE thành resource repair session riêng cho admin FE. */
  private mapRepairSession(
    session: AdminChatSession,
    technicianMap: Map<string, AdminTechnician>,
  ) {
    const technician =
      session.technicianId != null
        ? this.mapTechnician(
            technicianMap.get(String(session.technicianId)) ?? null,
          )
        : null;
    const customerName =
      session.user?.fullName?.trim() ||
      session.contactName?.trim() ||
      'Khách hàng';
    const customerPhone = session.contactPhone?.trim() || '--';

    return {
      id: String(session.id),
      deviceType: session.deviceType?.trim() || 'Thiết bị chưa xác định',
      symptom: session.symptom?.trim() || '',
      aiSummary: session.aiSummary?.trim() || null,
      isDangerous: session.isDangerous,
      status: session.status,
      version: session.version,
      contactName: session.contactName?.trim() || null,
      contactPhone: session.contactPhone?.trim() || null,
      address: session.address?.trim() || null,
      latitude: session.latitude ?? null,
      longitude: session.longitude ?? null,
      userId: String(session.userId),
      technicianId:
        session.technicianId != null ? String(session.technicianId) : null,
      deviceId: session.deviceId != null ? String(session.deviceId) : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      customer: {
        id: String(session.userId),
        fullName: customerName,
        phoneNumber: customerPhone,
        avatarUrl: session.user?.avatarUrl ?? null,
        address: session.address?.trim() || null,
        latitude: session.latitude ?? null,
        longitude: session.longitude ?? null,
        isActive: true,
        isVerified: false,
      },
      technician,
      device: null,
      assignmentHistory: this.buildAssignmentHistory(
        session,
        technician?.fullName,
      ),
      statusTimeline: this.buildStatusTimeline(session),
    };
  }

  /** Lấy danh sách repair session thật từ admin chats rồi enrich bằng dữ liệu kỹ thuật viên. */
  async getRepairSessions() {
    const sessions = await this.adminChatsService.getChats({});
    const [details, technicians] = await Promise.all([
      Promise.all(
        sessions.map((session) =>
          this.adminChatsService.getChatById(session.id),
        ),
      ),
      this.adminTechniciansService.getTechnicians(),
    ]);

    const technicianMap = new Map(technicians.map((item) => [item.id, item]));

    return details
      .filter((item): item is AdminChatSession => item != null)
      .map((session) => this.mapRepairSession(session, technicianMap));
  }

  /** Gán kỹ thuật viên cho repair session từ resource admin riêng. */
  assignTechnician(sessionId: number, technicianId: number) {
    return this.adminChatsService.assignTechnician(sessionId, technicianId);
  }

  /** Gỡ kỹ thuật viên khỏi repair session và trả ca về hàng chờ điều phối. */
  unassignTechnician(sessionId: number) {
    return this.adminChatsService.unassignTechnician(sessionId, 'UNASSIGNED');
  }

  /** Hủy repair session từ phía admin nhưng vẫn giữ lịch sử thao tác. */
  cancelRepairSession(sessionId: number) {
    return this.adminChatsService.cancelChat(sessionId);
  }
}
