import { Injectable, Logger, NotFoundException, BadRequestException,HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

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
          review: true, 
          quotes: {
            where: { status: 'ACCEPTED' },
            take: 1,
          },
          device: true, 
        },
        orderBy: {
          updatedAt: 'desc', 
        },
      });

      return jobs;

    } catch (error: any) {
      this.logger.error(`Lỗi khi lấy lịch sử đơn của thợ #${technicianId}: ${error.message}`);
      throw error;
    }
  }

  async getProfile(technicianId: number) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: technicianId },
        select: {
          fullName: true,
          phoneNumber: true,
          email: true,
          avatarUrl: true,
          averageRating: true,
          totalReviews: true,
        },
      });

      if (!user) throw new NotFoundException('Không tìm thấy tài khoản thợ');

      // Đếm số lượng đơn đã hoàn thành
      const completedJobsCount = await this.prisma.chatSession.count({
        where: {
          technicianId: technicianId,
          status: 'COMPLETED',
        },
      });

      return {
        ...user,
        completedJobsCount,
      };
    } catch (error) {
      throw error;
    }
  }

  // 2. Lấy danh sách đánh giá của khách hàng
  async getReviews(technicianId: number) {
    return this.prisma.review.findMany({
      where: { technicianId: technicianId },
      include: {
        user: { select: { fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 3. Đổi mật khẩu
  async changePassword(technicianId: number, data: any) {
    const { oldPassword, newPassword } = data;
    
    const user = await this.prisma.user.findUnique({ where: { id: technicianId } });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');

    // Kiểm tra mật khẩu cũ (Giả sử bạn mã hóa bằng bcrypt, nếu không thì so sánh chuỗi bình thường)
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new BadRequestException('Mật khẩu hiện tại không chính xác');

    // Mã hóa mật khẩu mới
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: technicianId },
      data: { password: hashedNewPassword },
    });

    return { message: 'Đổi mật khẩu thành công' };
  }
  async updateProfile(technicianId: number, body: any) {
    console.log('>>> Dữ liệu Backend thực tế nhận được từ Flutter:', body);
    // 1. Thêm fullName vào đây
    const { fullName, phoneNumber, email } = body; 

    try {
      const updatedUser = await this.prisma.user.update({
        where: { id: technicianId },
        data: {
          fullName: fullName,     // 2. Map fullName vào database
          phoneNumber: phoneNumber,
          email: email,
        },
        select: {
          fullName: true,
          phoneNumber: true,
          email: true,
          avatarUrl: true,
          averageRating: true,
          totalReviews: true,
        },
      });

      return updatedUser; 

    } catch (error) {
      console.error('Lỗi khi cập nhật profile:', error);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpException(
          'Số điện thoại hoặc Email này đã được sử dụng!',
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        'Không thể cập nhật thông tin hồ sơ. Vui lòng thử lại sau!',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}