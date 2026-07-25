import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
      let finalSummary = summary;

      // Xử lý trường hợp frontend gửi nguyên một chuỗi JSON (chứa "text", "state", v.v.)
      try {
        const parsedSummary = JSON.parse(summary);
        if (parsedSummary && typeof parsedSummary.text === 'string') {
          finalSummary = parsedSummary.text;
        }
      } catch (e) {
        // Không phải JSON, bỏ qua và giữ nguyên
      }

      if (finalSummary && finalSummary.length > 150) {
        try {
          const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
          const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const summaryPrompt = `Tóm tắt ngắn gọn (1-2 câu) tình trạng thiết bị dựa trên chẩn đoán sau. Không xưng hô, chỉ nêu vấn đề và hướng xử lý:\n${finalSummary}`;
          const result = await model.generateContent(summaryPrompt);
          if (result.response.text()) {
            finalSummary = result.response.text().trim();
          }
        } catch (e) {
          console.error('Lỗi khi tóm tắt chat bằng Gemini:', e);
        }
      }

      // Nếu đã có sessionId truyền lên từ Flutter -> UPDATE phiên cũ
      if (sessionId) {
        console.log(`🔄 [Prisma] Đang cập nhật Session cũ ID: ${sessionId}`);

        const result = await this.prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            aiSummary: finalSummary,
            symptom: finalSummary,
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
          aiSummary: finalSummary,
          symptom: finalSummary,
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