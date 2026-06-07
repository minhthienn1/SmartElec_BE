import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RepairHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy danh sách lịch sử sửa chữa (Chat với Thợ) của Khách hàng
   */
  async getRepairHistory(userId: number) {
    try {
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          userId: userId,
          technicianId: { not: null }, // Chắc chắn là có Thợ chứ không phải AI
          isHiddenByCustomer: false,
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          technician: {
            select: {
              fullName: true,
              phoneNumber: true,
              averageRating: true,
            },
          },
          review: {
            select: {
              rating: true,
              comment: true,
            },
          },
          quotes: {
            where: {
              status: 'ACCEPTED', // Chỉ lấy báo giá đã được chốt
            },
            take: 1,
          },
        },
      });

      // Map dữ liệu trả về theo đúng cấu trúc sạch mà Flutter cần
      return sessions.map((session) => {
        const acceptedQuote = session.quotes[0];
        return {
          id: session.id,
          date: session.createdAt,
          status: session.status,
          chatSummary: session.aiSummary || session.symptom || 'Đã thống nhất phương án sửa chữa.',
          mechanicName: session.technician?.fullName || 'Thợ sửa chữa',
          mechanicPhone: session.technician?.phoneNumber || 'Chưa cập nhật',
          rating: session.review?.rating || session.technician?.averageRating || 5.0,
          reviewComment: session.review?.comment || 'Khách hàng không để lại bình luận.',
          agreedPrice: acceptedQuote 
            ? `${acceptedQuote.amount.toLocaleString('vi-VN')} VND` 
            : 'Chưa chốt giá',
        };
      });
    } catch (error) {
      console.error('❌ LỖI LẤY LỊCH SỬ SỬA CHỮA:', error);
      throw new InternalServerErrorException('Không thể tải lịch sử sửa chữa.');
    }
  }
}