import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lưu hoặc Cập nhật phiên chẩn đoán vào bảng `chatSession`.
   * @param userId    - ID của user
   * @param title     - Tên thiết bị
   * @param summary   - Tóm tắt mới nhất từ AI
   * @param sessionId - (Tùy chọn) ID của phiên chat hiện tại nếu đã có
   * @param sessionType - (Tùy chọn) Loại phiên chat (VD: DIRECT_BOOKING)
   */
  async saveSession(userId: number, title: string, summary: string, sessionId?: number, sessionType?: 'AI_DIAGNOSIS' | 'DIRECT_BOOKING') {
    try {
      // 🟢 Nếu đã có sessionId truyền lên từ Flutter -> Tiến hành UPDATE
      if (sessionId) {
        console.log(`🔄 [Prisma] Đang cập nhật Session cũ ID: ${sessionId}`);
        const result = await this.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            aiSummary: summary,
            symptom: summary, // Cập nhật triệu chứng mới nhất
          },
          select: {
            id: true,
            deviceType: true,
            aiSummary: true,
            createdAt: true,
            userId: true,
            symptom: true,
            status: true,
          },
        });
        return result;
      }

      // 🟢 Nếu CHƯA có sessionId -> Tạo phiên mới (CREATE) như cũ
      console.log('➕ [Prisma] Đang tạo một Session mới hoàn toàn');
      const result = await this.prisma.chatSession.create({
        data: {
          userId,
          deviceType: title,
          aiSummary: summary,
          symptom: summary,
          sessionType: sessionType ?? 'AI_DIAGNOSIS',
        },
        select: {
          id: true,
          deviceType: true,
          aiSummary: true,
          createdAt: true,
          userId: true,
          symptom: true,
          status: true,
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
   * Sắp xếp theo `createdAt` giảm dần (mới nhất lên đầu).
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
          symptom: true, // ➕ Lấy vấn đề để Flutter hiện lên Card
          status: true,  // ➕ Lấy trạng thái để Flutter đổi màu
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Không thể tải lịch sử chẩn đoán. Vui lòng thử lại.',
      );
    }
  }
}