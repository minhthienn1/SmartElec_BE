import { Injectable, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async createDevice(userId: number, dto: CreateDeviceDto) {
    try {
      let nextMaintenanceDate: Date | null = null;
      const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : null;

      let maintenanceCycle = dto.maintenanceCycleMonths;

      // Áp dụng quy tắc tĩnh nếu không truyền vào
      if (!maintenanceCycle) {
        switch (dto.category) {
          case 'Máy lạnh':
          case 'Điều hòa':
            maintenanceCycle = 6;
            break;
          case 'Máy giặt':
            maintenanceCycle = 12;
            break;
          case 'Lọc nước':
          case 'Máy lọc nước':
            maintenanceCycle = 3;
            break;
          case 'Tủ lạnh':
          case 'Tivi':
            maintenanceCycle = 12;
            break;
          default:
            maintenanceCycle = 6; // Mặc định 6 tháng
        }
      }

      if (maintenanceCycle) {
        const baseDate = purchaseDate ? new Date(purchaseDate) : new Date();
        // Tính toán ngày bảo trì tiếp theo bằng cách thêm số tháng vào baseDate
        nextMaintenanceDate = new Date(baseDate);
        nextMaintenanceDate.setMonth(nextMaintenanceDate.getMonth() + maintenanceCycle);
      }

      const device = await this.prisma.device.create({
        data: {
          category: dto.category,
          brandName: dto.brandName,
          modelCode: dto.modelCode,
          location: dto.location,
          purchaseDate: purchaseDate,
          warrantyMonths: dto.warrantyMonths,
          maintenanceCycleMonths: maintenanceCycle,
          nextMaintenanceDate: nextMaintenanceDate,
          userId: userId,
        },
      });

      return device;
    } catch (error) {
      throw new InternalServerErrorException('Không thể thêm thiết bị mới');
    }
  }

  async getUserDevices(userId: number) {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDeviceById(id: number, userId: number) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: {
        chatSessions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!device) {
      throw new NotFoundException('Thiết bị không tồn tại');
    }

    if (device.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem thiết bị này');
    }

    return device;
  }

  async deleteDevice(id: number, userId: number) {
    const device = await this.getDeviceById(id, userId); // Kiểm tra tồn tại và quyền sở hữu
    
    await this.prisma.device.delete({
      where: { id: device.id },
    });

    return { message: 'Đã xóa thiết bị thành công' };
  }

  async updateDevice(id: number, userId: number, dto: any) {
    const device = await this.getDeviceById(id, userId);

    let nextMaintenanceDate: Date | null = device.nextMaintenanceDate;
    
    const purchaseDate = dto.purchaseDate !== undefined ? (dto.purchaseDate ? new Date(dto.purchaseDate) : null) : device.purchaseDate;
    const maintenanceCycle = dto.maintenanceCycleMonths !== undefined ? dto.maintenanceCycleMonths : device.maintenanceCycleMonths;

    if (dto.nextMaintenanceDate !== undefined) {
      // Nếu client gửi nextMaintenanceDate trực tiếp (ví dụ: nút "Đã bảo trì")
      nextMaintenanceDate = dto.nextMaintenanceDate ? new Date(dto.nextMaintenanceDate) : null;
    } else if (dto.purchaseDate !== undefined || dto.maintenanceCycleMonths !== undefined) {
      // Chỉ tự động tính toán lại nếu có thay đổi ngày mua hoặc chu kỳ bảo trì
      if (maintenanceCycle) {
        const baseDate = purchaseDate ? new Date(purchaseDate) : new Date();
        nextMaintenanceDate = new Date(baseDate);
        nextMaintenanceDate.setMonth(nextMaintenanceDate.getMonth() + maintenanceCycle);
      }
    }

    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        category: dto.category,
        brandName: dto.brandName,
        modelCode: dto.modelCode,
        location: dto.location,
        purchaseDate: purchaseDate,
        warrantyMonths: dto.warrantyMonths,
        maintenanceCycleMonths: dto.maintenanceCycleMonths,
        nextMaintenanceDate: nextMaintenanceDate,
      },
    });

    return updated;
  }
}
