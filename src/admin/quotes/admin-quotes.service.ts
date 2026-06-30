import { Injectable } from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { AdminChatsService } from '../chats/admin-chats.service';

type QuoteLifecycleStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

type AdminChatSession = NonNullable<
  Awaited<ReturnType<AdminChatsService['getChatById']>>
>;

type AdminChatQuery = Parameters<AdminChatsService['getChats']>[0];

type QuoteListQuery = {
  keyword?: string;
  status?: QuoteLifecycleStatus;
  address?: string;
  technicianName?: string;
  minAmount?: string;
  maxAmount?: string;
  isOverdue?: string;
  isMismatch?: string;
};

@Injectable()
export class AdminQuotesService {
  constructor(private readonly adminChatsService: AdminChatsService) {}

  /** Ép metadata của message về object để đọc các trường quote an toàn hơn trong service admin. */
  private asMetadata(metadata: unknown) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as Record<string, unknown>;
    }

    return {};
  }

  /** Chuẩn hóa trạng thái báo giá từ metadata message sang tập trạng thái mà FE admin đang dùng. */
  private toLifecycleStatus(value?: QuoteStatus | null): QuoteLifecycleStatus {
    if (value === 'ACCEPTED' || value === 'REJECTED') {
      return value;
    }

    return 'PENDING';
  }

  /** Lấy toàn bộ chi tiết session cần thiết để bóc tách lịch sử báo giá đầy đủ. */
  private async getDetailedSessions(query: AdminChatQuery) {
    const sessions = await this.adminChatsService.getChats(query);
    const details = await Promise.all(
      sessions.map((session) => this.adminChatsService.getChatById(session.id)),
    );

    return details.filter((item): item is AdminChatSession => item != null);
  }

  /** Lọc ra các message liên quan trực tiếp đến báo giá trong một session. */
  private getQuoteMessages(session: AdminChatSession) {
    return (session.messages ?? []).filter((message) => {
      return message.type === 'QUOTE_CARD' || message.type === 'QUOTE_RESPONSE';
    });
  }

  /** Dựng lịch sử thao tác của một báo giá từ chuỗi message cùng quoteId. */
  private buildHistory(
    messages: AdminChatSession['messages'],
    quoteId: number,
  ) {
    return (messages ?? [])
      .filter(
        (message) =>
          Number(this.asMetadata(message.metadata).quoteId) === quoteId,
      )
      .map((message) => {
        const metadata = this.asMetadata(message.metadata);

        return {
          id: String(message.id),
          action: metadata.quoteStatus
            ? `QUOTE_${String(metadata.quoteStatus)}`
            : message.type,
          actor:
            message.sender?.fullName?.trim() ||
            message.sender?.role ||
            'Hệ thống',
          at: message.createdAt,
          note: message.content,
        };
      })
      .sort((left, right) => right.at.localeCompare(left.at));
  }

  /** Dựng ca máy gắn với báo giá để FE có thể hiển thị thêm bối cảnh sửa chữa. */
  private buildMachineShifts(session: AdminChatSession) {
    return [
      {
        id: `shift-${session.id}`,
        machineCode: session.deviceType?.trim() || 'UNKNOWN',
        shiftCode: `CS-${session.id}`,
        startedAt: session.createdAt,
        endedAt: ['COMPLETED', 'DONE', 'CANCELLED'].includes(session.status)
          ? session.updatedAt
          : undefined,
      },
    ];
  }

  /** Bóc tách toàn bộ báo giá từ một session chi tiết của admin chats. */
  private extractQuotesFromSession(session: AdminChatSession) {
    const quoteMessages = this.getQuoteMessages(session);

    return quoteMessages.map((message, index) => {
      const metadata = this.asMetadata(message.metadata);
      const quoteId = Number(metadata.quoteId) || message.id;
      const totalAmount = Number(metadata.amount) || 0;
      const status = this.toLifecycleStatus(
        (metadata.quoteStatus as QuoteStatus | undefined) ?? undefined,
      );
      const waitingMinutes = Math.max(
        0,
        Math.round(
          (Date.now() - new Date(message.createdAt).getTime()) / 60000,
        ),
      );
      const sessionStatus = session.status;
      const isCurrentQuote = index === quoteMessages.length - 1;
      const isOverdueLv2 = status === 'PENDING' && waitingMinutes >= 120;
      const isOverdueLv1 = status === 'PENDING' && waitingMinutes >= 45;
      const isStateMismatch =
        (status === 'ACCEPTED' && sessionStatus === 'BROADCASTING') ||
        (status === 'PENDING' &&
          ['COMPLETED', 'DONE', 'CANCELLED'].includes(sessionStatus));

      return {
        id: `Q-${quoteId}`,
        sessionId: String(session.id),
        technicianId:
          session.technicianId != null ? String(session.technicianId) : '',
        customerName:
          session.user?.fullName?.trim() ||
          session.contactName?.trim() ||
          'Khách hàng',
        customerPhone: session.contactPhone?.trim() || '--',
        technicianName: session.technician?.fullName?.trim() || '--',
        deviceName: String(
          metadata.contextDevice || session.deviceType || '--',
        ),
        issueSummary:
          session.symptom?.trim() || session.aiSummary?.trim() || '--',
        totalAmount,
        currency: 'VND' as const,
        status,
        createdAt: message.createdAt,
        updatedAt: session.updatedAt,
        validUntil: undefined,
        sessionStatus,
        waitingMinutes,
        isOverdueLv1,
        isOverdueLv2,
        isStateMismatch,
        isCurrentQuote,
        isAbnormalAmount: totalAmount >= 5_000_000,
        address: session.address?.trim() || '--',
        history: this.buildHistory(session.messages, quoteId),
        machineShifts: this.buildMachineShifts(session),
      };
    });
  }

  /** Kiểm tra một báo giá có khớp bộ lọc admin hiện tại hay không. */
  private matchesQuery(
    item: ReturnType<AdminQuotesService['extractQuotesFromSession']>[number],
    query: QuoteListQuery,
  ) {
    const keyword = query.keyword?.trim().toLowerCase();
    if (keyword) {
      const haystack = [
        item.id,
        item.sessionId,
        item.customerName,
        item.customerPhone,
        item.deviceName,
        item.issueSummary,
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(keyword)) {
        return false;
      }
    }

    if (query.status && item.status !== query.status) return false;
    if (
      query.address &&
      !item.address.toLowerCase().includes(query.address.trim().toLowerCase())
    ) {
      return false;
    }
    if (
      query.technicianName &&
      !item.technicianName
        .toLowerCase()
        .includes(query.technicianName.trim().toLowerCase())
    ) {
      return false;
    }

    const minAmount = Number(query.minAmount);
    const maxAmount = Number(query.maxAmount);
    if (Number.isFinite(minAmount) && item.totalAmount < minAmount)
      return false;
    if (Number.isFinite(maxAmount) && item.totalAmount > maxAmount)
      return false;
    if (
      query.isOverdue === 'true' &&
      !(item.isOverdueLv1 || item.isOverdueLv2)
    ) {
      return false;
    }
    if (query.isMismatch === 'true' && !item.isStateMismatch) return false;

    return true;
  }

  /** Trả về danh sách báo giá admin đã được chuẩn hóa sang shape FE đang dùng. */
  async getQuotes(query: QuoteListQuery) {
    const sessions = await this.getDetailedSessions({
      keyword: query.keyword,
      address: query.address,
      technicianName: query.technicianName,
    });

    return sessions
      .flatMap((session) => this.extractQuotesFromSession(session))
      .filter((item) => this.matchesQuery(item, query))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}
