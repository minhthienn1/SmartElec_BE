import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lưu một phiên chẩn đoán mới vào bảng `chatSession`.
   * @param userId  - ID của user đang đăng nhập (lấy từ JWT token)
   * @param title   - Tên thiết bị (map sang `deviceType` ở Prisma)
   * @param summary - Tóm tắt chẩn đoán của AI (map sang `aiSummary` ở Prisma)
   */
  async saveSession(userId: number, title: string, summary: string) {
    try {
      const result = await this.prisma.chatSession.create({
        data: {
          userId,
          deviceType: title,
          aiSummary: summary,
          symptom: summary, // ✅ Lưu mô tả vào cả symptom để thợ xem được trên Job Board
        },
        select: {
          id: true,
          deviceType: true,
          aiSummary: true,
          createdAt: true,
          userId: true,
        },
      });
      console.log('✅ TRẠNG THÁI: Lưu Prisma THÀNH CÔNG ->', result.id);
      return result;
    } catch (error) {
      console.error('❌ LỖI DATABASE PRISMA:', error);
      throw new InternalServerErrorException(
        'Không thể lưu phiên chẩn đoán. Vui lòng thử lại.',
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
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          deviceType: true,
          aiSummary: true,
          createdAt: true,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Không thể tải lịch sử chẩn đoán. Vui lòng thử lại.',
      );
    }
  }
}