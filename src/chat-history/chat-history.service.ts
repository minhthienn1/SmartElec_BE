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
   */
  async saveSession(userId: number, title: string, summary: string, sessionId?: number) {
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
        where: { userId, isHiddenByCustomer: false, },
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

  async hideChatSession(sessionId: number, userId: number) {
  // Cập nhật cờ isHiddenByCustomer thành true thay vì xóa khỏi database
  return await this.prisma.chatSession.update({
    where: { 
      id: sessionId,
      // Đảm bảo chỉ chính khách hàng đó mới có quyền ẩn session của họ
      userId: userId 
    },
    data: { 
      isHiddenByCustomer: true 
    },
  });
}

/**
   * Ẩn (xóa mềm) nhiều session cùng lúc bằng updateMany
   * @param sessionIds - Mảng chứa các ID cần ẩn
   * @param userId - ID của user đang thao tác (để bảo mật)
   */
  async hideMultipleChatSessions(sessionIds: number[], userId: number) {
    try {
      const result = await this.prisma.chatSession.updateMany({
        where: { 
          // Chỉ chọn những bản ghi có id nằm trong mảng sessionIds
          id: { in: sessionIds },
          // BẢO MẬT: Đảm bảo chỉ cập nhật các session thuộc về đúng user này
          userId: userId 
        },
        data: { 
          isHiddenByCustomer: true 
        },
      });

      console.log(`✅ Đã xóa thành công ${result.count} phiên chẩn đoán cho User ${userId}`);
      
      // Trả về số lượng đã ẩn thành công để FE có thể kiểm tra nếu cần
      return { 
        success: true, 
        hiddenCount: result.count 
      };
    } catch (error) {
      console.error('❌ LỖI DATABASE PRISMA (hideMultiple):', error);
      throw new InternalServerErrorException(
        'Có lỗi xảy ra khi xóa các phiên chẩn đoán. Vui lòng thử lại sau.',
      );
    }
  }
}