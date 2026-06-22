import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Gender } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        phoneNumber: true,
        email: true,
        gender: true,
        avatarUrl: true,
        avatarData: true,
        address: true,
        role: true,
        averageRating: true,
        totalReviews: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException(`Không tìm thấy user ${userId}`);
    const { avatarData, ...rest } = user as any;
    return {
      ...rest,
      avatarBase64: avatarData ? (avatarData as Buffer).toString('base64') : null,
    };
  }

  async updateProfile(id: number, data: { fullName?: string, email?: string, address?: string, gender?: string }) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        // Ép kiểu gender từ string sang Enum Gender của Prisma
        gender: data.gender ? (data.gender as Gender) : undefined,
      },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        gender: true,
        email: true,
        avatarUrl: true,
        avatarData: true,
        address: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng với ID ${id}`);
    }

    const { avatarData, ...rest } = user as any;
    return {
      ...rest,
      avatarBase64: avatarData ? (avatarData as Buffer).toString('base64') : null,
    };
  }

  async updateFcmToken(userId: number, token: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
  }

  async toggleOnline(userId: number, lat?: number, lng?: number, isOnline?: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    
    return this.prisma.user.update({
      where: { id: userId },
      data: { 
        isOnline: isOnline !== undefined ? isOnline : !user.isOnline,
        lastLogin: new Date(),
        ...(lat && { latitude: lat }),
        ...(lng && { longitude: lng }),
      },
    });
  }

  // Upload và lưu ảnh đại diện trực tiếp vào database (Bytes / BLOB)
  async uploadAvatar(userId: number, fileBuffer: Buffer): Promise<{ avatarBase64: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`Không tìm thấy user ${userId}`);

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarData: fileBuffer },
    });

    // Trả về chuỗi base64 để app hiển thị ngay lập tức (không cần gọi API lại)
    return { avatarBase64: fileBuffer.toString('base64') };
  }

  // Lấy ảnh đại diện dưới dạng base64 string
  async getAvatarBase64(userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarData: true },
    });
    if (!user || !user.avatarData) return null;
    return (user.avatarData as Buffer).toString('base64');
  }
}