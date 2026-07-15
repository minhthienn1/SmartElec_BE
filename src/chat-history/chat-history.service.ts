import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ChatSessionType = 'AI_DIAGNOSIS' | 'DIRECT_BOOKING';

@Injectable()
export class ChatHistoryService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Lưu hoặc cập nhật phiên chẩn đoán vào bảng `chatSession`.
   *
   * @param userId      - ID của user
   * @param title       - Tên thiết bị
   * @param summary     - Tóm tắt mới nhất từ AI
   * @param sessionId   - ID phiên chat hiện tại nếu đã có
   * @param sessionType - Loại phiên chat, ví dụ: AI_DIAGNOSIS hoặc DIRECT_BOOKING
   */
  async saveSession(
    userId: number,
    title: string,
    summary: string,
    sessionId?: number,
    sessionType: ChatSessionType = 'AI_DIAGNOSIS',
  ) {
    try {
      // Nếu đã có sessionId truyền lên từ Flutter -> UPDATE phiên cũ
      if (sessionId) {
        console.log(`🔄 [Prisma] Đang cập nhật Session cũ ID: ${sessionId}`);

        const result = await this.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            aiSummary: summary,
            symptom: summary,
          },
          select: {
            id: true,
            deviceType: true,
            aiSummary: true,
            createdAt: true,
            userId: true,
            symptom: true,
            status: true,
            sessionType: true,
          },
        });

        return result;
      }

      // Nếu chưa có sessionId -> CREATE phiên mới
      console.log('➕ [Prisma] Đang tạo một Session mới hoàn toàn');

      const result = await this.prisma.chatSession.create({
        data: {
          userId,
          deviceType: title,
          aiSummary: summary,
          symptom: summary,
          sessionType,
        },
        select: {
          id: true,
          deviceType: true,
          aiSummary: true,
          createdAt: true,
          userId: true,
          symptom: true,
          status: true,
          sessionType: true,
        },
      });

      return result;
    } catch (error) {
      console.error('❌ LỖI DATABASE PRISMA:', error);

      throw new InternalServerErrorException(
        'Không thể lưu/cập nhật phiên chẩn đoán.',
      );
    }
  }

  /**
   * Lấy toàn bộ lịch sử chẩn đoán của một user.
   * Sắp xếp theo `createdAt` giảm dần, mới nhất lên đầu.
   *
   * @param userId - ID của user cần truy vấn
   */
  async getUserHistory(userId: number) {
    try {
      return await this.prisma.chatSession.findMany({
        where: { 
          userId,
          sessionType: 'AI_DIAGNOSIS', // Lọc chỉ lấy các phiên chat với AI (loại trừ DIRECT_BOOKING)
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          deviceType: true,
          aiSummary: true,
          createdAt: true,
          symptom: true,
          status: true,
          sessionType: true,
        },
      });
    } catch (error) {
      console.error('❌ LỖI DATABASE PRISMA:', error);

      throw new InternalServerErrorException(
        'Không thể tải lịch sử chẩn đoán. Vui lòng thử lại.',
      );
    }
  }
}