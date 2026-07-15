import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminTechniciansService {
  constructor(private readonly prisma: PrismaService) {}

  async getTechnicians() {
    const technicians = await this.prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        gender: true,
        email: true,
        avatarUrl: true,
        address: true,
        role: true,
        isVerified: true,
        isActive: true,
        isOnline: true,
        latitude: true,
        longitude: true,
        lastLogin: true,
        createdAt: true,
        averageRating: true,
        totalReviews: true,
        technicianSessions: {
          select: {
            id: true,
            status: true,
            deviceType: true,
            symptom: true,
            address: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }],
        },
      },
    });

    return technicians.map((technician) => {
      const activeStatuses = ['MATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
      const currentJob =
        technician.technicianSessions.find((item) =>
          activeStatuses.includes(item.status),
        ) ?? null;

      return {
        id: String(technician.id),
        phoneNumber: technician.phoneNumber,
        fullName: technician.fullName ?? '',
        gender: technician.gender,
        email: technician.email ?? '',
        avatarUrl: technician.avatarUrl,
        address: technician.address ?? '',
        role: 'TECHNICIAN' as const,
        isVerified: technician.isVerified,
        isActive: technician.isActive,
        isOnline: technician.isOnline,
        latitude: technician.latitude,
        longitude: technician.longitude,
        lastLogin: technician.lastLogin?.toISOString() ?? '',
        createdAt: technician.createdAt.toISOString(),
        averageRating: technician.averageRating ?? 0,
        totalReviews: technician.totalReviews ?? 0,
        activeJobCount: technician.technicianSessions.filter((item) =>
          activeStatuses.includes(item.status),
        ).length,
        completedJobCount: technician.technicianSessions.filter((item) =>
          ['COMPLETED', 'DONE'].includes(item.status),
        ).length,
        cancelledJobCount: technician.technicianSessions.filter(
          (item) => item.status === 'CANCELLED',
        ).length,
        currentJob: currentJob
          ? {
              id: String(currentJob.id),
              status: currentJob.status,
              deviceType: currentJob.deviceType ?? '',
              symptom: currentJob.symptom ?? '',
              address: currentJob.address ?? '',
              updatedAt: currentJob.updatedAt.toISOString(),
            }
          : null,
      };
    });
  }
}
