import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TechnicianService {
  private readonly logger = new Logger(TechnicianService.name);

  constructor(private prisma: PrismaService) {}

  async getCompletedJobs(technicianId: number) {
    try {
      const jobs = await this.prisma.chatSession.findMany({
        where: {
          technicianId: technicianId, 
          status: 'COMPLETED',
        },
        include: {
          // Lấy thông tin user
          user: {
            select: { fullName: true, phoneNumber: true, avatarUrl: true }, 
          },
          // Lấy review (không giới hạn field để FE đọc được rating và comment)
          review: true, 
          // Lấy báo giá đã chấp nhận để FE đọc được amount và expectedTime
          quotes: {
            where: { status: 'ACCEPTED' },
            take: 1,
          },
          // THÊM: Lấy thông tin thiết bị để FE hiển thị được tên máy (ví dụ: Tủ lạnh, Máy lạnh...)
          device: true, 
        },
        orderBy: {
          updatedAt: 'desc', // Sắp xếp theo thời gian hoàn thành mới nhất
        },
      });

      // TRẢ VỀ NGUYÊN BẢN ARRAY JOBS ĐỂ FRONTEND TỰ BÓC TÁCH DỮ LIỆU
      return jobs;

    } catch (error: any) {
      this.logger.error(`Lỗi khi lấy lịch sử đơn của thợ #${technicianId}: ${error.message}`);
      throw error;
    }
  }
}