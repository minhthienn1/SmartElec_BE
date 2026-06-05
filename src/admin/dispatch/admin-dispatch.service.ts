import { Injectable } from '@nestjs/common';
import { AdminChatsService } from '../chats/admin-chats.service';
import { AdminRepairSessionsService } from '../repair-sessions/admin-repair-sessions.service';
import { AdminTechniciansService } from '../technicians/admin-technicians.service';

type RepairSession = Awaited<
  ReturnType<AdminRepairSessionsService['getRepairSessions']>
>[number];

type AdminTechnician = Awaited<
  ReturnType<AdminTechniciansService['getTechnicians']>
>[number];

@Injectable()
export class AdminDispatchService {
  constructor(
    private readonly adminChatsService: AdminChatsService,
    private readonly adminRepairSessionsService: AdminRepairSessionsService,
    private readonly adminTechniciansService: AdminTechniciansService,
  ) {}

  /** Chuẩn hóa repair session sang row điều phối mà FE dispatch đang hiển thị. */
  private mapSession(session: RepairSession) {
    return {
      id: session.id,
      symptom: session.symptom,
      deviceType: session.deviceType,
      address: session.address ?? '--',
      latitude: session.latitude,
      longitude: session.longitude,
      createdAt: session.createdAt,
      status: session.status === 'DONE' ? 'COMPLETED' : session.status,
      version: session.version,
      customerName: session.customer.fullName,
      customerPhone: session.customer.phoneNumber,
      technicianId: session.technicianId,
      technician: session.technician
        ? {
            id: session.technician.id,
            fullName: session.technician.fullName,
            phoneNumber: session.technician.phoneNumber,
            averageRating: session.technician.averageRating,
            activeJobCount: session.technician.currentWorkload ?? 0,
            distance: session.technician.distanceKm ?? 0,
            isOnline: session.technician.isOnline,
            isActive: session.technician.isActive,
            isVerified: session.technician.isVerified,
          }
        : null,
    };
  }

  /** Chuẩn hóa technician admin sang candidate cho drawer điều phối. */
  private mapCandidates(technicians: AdminTechnician[]) {
    return technicians.map((technician) => ({
      id: technician.id,
      fullName: technician.fullName,
      phoneNumber: technician.phoneNumber,
      averageRating: technician.averageRating,
      activeJobCount: technician.activeJobCount,
      distance: 0,
      isOnline: technician.isOnline,
      isActive: technician.isActive,
      isVerified: technician.isVerified,
    }));
  }

  /** Tạo lịch sử điều phối thống nhất từ assignment history của từng repair session. */
  private mapHistory(sessions: RepairSession[]) {
    return sessions
      .flatMap((session) =>
        session.assignmentHistory.map((item) => ({
          id: item.id,
          sessionId: session.id,
          action: item.action,
          technicianName: item.technicianName ?? null,
          operatorName: 'Admin',
          reason: item.reason ?? null,
          createdAt: item.createdAt,
        })),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Lấy snapshot điều phối hoàn chỉnh từ resource repair session và technicians. */
  async getDispatchData() {
    const [sessions, technicians] = await Promise.all([
      this.adminRepairSessionsService.getRepairSessions(),
      this.adminTechniciansService.getTechnicians(),
    ]);

    return {
      sessions: sessions.map((session) => this.mapSession(session)),
      candidates: this.mapCandidates(technicians),
      history: this.mapHistory(sessions),
    };
  }

  /** Gán kỹ thuật viên cho một phiên dispatch từ resource riêng. */
  assign(sessionId: number, technicianId: number) {
    return this.adminChatsService.assignTechnician(sessionId, technicianId);
  }

  /** Gỡ kỹ thuật viên khỏi ca dispatch và trả ca về hàng chờ. */
  unassign(sessionId: number) {
    return this.adminChatsService.unassignTechnician(sessionId, 'UNASSIGNED');
  }

  /** Ghi nhận kỹ thuật viên từ chối nhận ca trong luồng dispatch. */
  reject(sessionId: number) {
    return this.adminChatsService.unassignTechnician(sessionId, 'REJECTED');
  }

  /** Ghi nhận timeout phản hồi của kỹ thuật viên để mở lại điều phối. */
  simulateTimeout(sessionId: number) {
    return this.adminChatsService.unassignTechnician(
      sessionId,
      'SYSTEM_AUTO_CANCEL',
    );
  }
}
