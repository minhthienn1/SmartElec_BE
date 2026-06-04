import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tạo thiết bị mới cho người dùng hiện tại và tính sẵn lịch bảo trì nếu có dữ liệu đầu vào. */
  async createDevice(userId: number, dto: CreateDeviceDto) {
    try {
      let nextMaintenanceDate: Date | null = null;
      const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : null;

      let maintenanceCycle = dto.maintenanceCycleMonths;

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
            maintenanceCycle = 6;
        }
      }

      if (maintenanceCycle) {
        const baseDate = purchaseDate ? new Date(purchaseDate) : new Date();
        nextMaintenanceDate = new Date(baseDate);
        nextMaintenanceDate.setMonth(
          nextMaintenanceDate.getMonth() + maintenanceCycle,
        );
      }

      return await this.prisma.device.create({
        data: {
          category: dto.category,
          brandName: dto.brandName,
          modelCode: dto.modelCode,
          location: dto.location,
          purchaseDate,
          warrantyMonths: dto.warrantyMonths,
          maintenanceCycleMonths: maintenanceCycle,
          nextMaintenanceDate,
          userId,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException('Không thể thêm thiết bị mới');
    }
  }

  /** Lấy toàn bộ thiết bị thuộc về người dùng hiện tại. */
  async getUserDevices(userId: number) {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Lấy chi tiết một thiết bị của người dùng hiện tại cùng các phiên chat liên quan. */
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

  /** Xóa thiết bị của người dùng hiện tại sau khi xác thực quyền sở hữu. */
  async deleteDevice(id: number, userId: number) {
    const device = await this.getDeviceById(id, userId);

    await this.prisma.device.delete({
      where: { id: device.id },
    });

    return { message: 'Đã xóa thiết bị thành công' };
  }

  /** Cập nhật thiết bị của người dùng hiện tại và tính lại lịch bảo trì khi cần. */
  async updateDevice(id: number, userId: number, dto: any) {
    const device = await this.getDeviceById(id, userId);

    let nextMaintenanceDate: Date | null = device.nextMaintenanceDate;

    const purchaseDate =
      dto.purchaseDate !== undefined
        ? dto.purchaseDate
          ? new Date(dto.purchaseDate)
          : null
        : device.purchaseDate;
    const maintenanceCycle =
      dto.maintenanceCycleMonths !== undefined
        ? dto.maintenanceCycleMonths
        : device.maintenanceCycleMonths;

    if (dto.nextMaintenanceDate !== undefined) {
      nextMaintenanceDate = dto.nextMaintenanceDate
        ? new Date(dto.nextMaintenanceDate)
        : null;
    } else if (
      dto.purchaseDate !== undefined ||
      dto.maintenanceCycleMonths !== undefined
    ) {
      if (maintenanceCycle) {
        const baseDate = purchaseDate ? new Date(purchaseDate) : new Date();
        nextMaintenanceDate = new Date(baseDate);
        nextMaintenanceDate.setMonth(
          nextMaintenanceDate.getMonth() + maintenanceCycle,
        );
      }
    }

    return this.prisma.device.update({
      where: { id: device.id },
      data: {
        category: dto.category,
        brandName: dto.brandName,
        modelCode: dto.modelCode,
        location: dto.location,
        purchaseDate,
        warrantyMonths: dto.warrantyMonths,
        maintenanceCycleMonths: dto.maintenanceCycleMonths,
        nextMaintenanceDate,
      },
    });
  }

  /** Trả về toàn bộ thiết bị cho màn quản trị kèm thông tin khách hàng và lịch sử ca sửa. */
  async adminGetAllDevices() {
    return this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
          },
        },
        chatSessions: {
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            symptom: true,
            aiSummary: true,
            deviceType: true,
            status: true,
            updatedAt: true,
            technician: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    });
  }

  /** Trả về chi tiết một thiết bị cho admin mà không giới hạn theo chủ sở hữu. */
  async adminGetDeviceById(id: number) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
          },
        },
        chatSessions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            symptom: true,
            aiSummary: true,
            deviceType: true,
            status: true,
            updatedAt: true,
            technician: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      throw new NotFoundException('Thiết bị hoặc đơn hàng không tồn tại');
    }

    return device;
  }
}
