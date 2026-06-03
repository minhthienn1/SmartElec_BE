import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type AccountListQuery = {
  keyword?: string;
  role?: string;
  status?: string;
  verified?: string;
  page?: string;
  pageSize?: string;
};

@Injectable()
export class AdminAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(query: AccountListQuery): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const and: Prisma.UserWhereInput[] = [];
    const keyword = query.keyword?.trim();

    if (keyword) {
      and.push({
        OR: [
          { fullName: { contains: keyword, mode: 'insensitive' } },
          { phoneNumber: { contains: keyword, mode: 'insensitive' } },
          { email: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }

    if (query.role && ['USER', 'TECHNICIAN', 'ADMIN'].includes(query.role)) {
      and.push({ role: query.role as UserRole });
    }

    if (query.status === 'ACTIVE') {
      and.push({ isActive: true });
    } else if (query.status === 'LOCKED') {
      and.push({ isActive: false });
    }

    if (query.verified === 'VERIFIED') {
      and.push({ isVerified: true });
    } else if (query.verified === 'UNVERIFIED') {
      and.push({ isVerified: false });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private mapAccount(user: {
    id: number;
    fullName: string | null;
    phoneNumber: string;
    email: string | null;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    role: UserRole;
    avatarUrl: string | null;
    address: string | null;
    isActive: boolean;
    isVerified: boolean;
    isOnline: boolean;
    lastLogin: Date | null;
    createdAt: Date;
    latitude: number | null;
    longitude: number | null;
    _count: {
      devices: number;
      chatSessions: number;
      technicianSessions: number;
      reviewsGiven: number;
      reviewsReceived: number;
    };
  }) {
    const repairJobsCount =
      user.role === 'TECHNICIAN' ? user._count.technicianSessions : user._count.chatSessions;
    const reviewsCount =
      user.role === 'TECHNICIAN' ? user._count.reviewsReceived : user._count.reviewsGiven;

    return {
      id: String(user.id),
      fullName: user.fullName ?? '',
      phoneNumber: user.phoneNumber,
      email: user.email ?? '',
      gender: user.gender,
      role: user.role,
      avatarUrl: user.avatarUrl,
      address: user.address ?? '',
      isActive: user.isActive,
      isVerified: user.isVerified,
      isOnline: user.isOnline,
      lastLogin: user.lastLogin?.toISOString() ?? '',
      createdAt: user.createdAt.toISOString(),
      devicesCount: user._count.devices,
      repairJobsCount,
      reviewsCount,
      latitude: user.latitude,
      longitude: user.longitude,
    };
  }

  async getAccounts(query: AccountListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 10));
    const skip = (page - 1) * pageSize;
    const where = this.buildWhere(query);

    const [items, total, summarySource] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          email: true,
          gender: true,
          role: true,
          avatarUrl: true,
          address: true,
          isActive: true,
          isVerified: true,
          isOnline: true,
          lastLogin: true,
          createdAt: true,
          latitude: true,
          longitude: true,
          _count: {
            select: {
              devices: true,
              chatSessions: true,
              technicianSessions: true,
              reviewsGiven: true,
              reviewsReceived: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          role: true,
          isActive: true,
          isVerified: true,
          isOnline: true,
        },
      }),
    ]);

    const summary = {
      total,
      active: summarySource.filter((item) => item.isActive).length,
      locked: summarySource.filter((item) => !item.isActive).length,
      verified: summarySource.filter((item) => item.isVerified).length,
      unverified: summarySource.filter((item) => !item.isVerified).length,
      online: summarySource.filter((item) => item.isOnline).length,
      customers: summarySource.filter((item) => item.role === 'USER').length,
      technicians: summarySource.filter((item) => item.role === 'TECHNICIAN').length,
      admins: summarySource.filter((item) => item.role === 'ADMIN').length,
    };

    return {
      items: items.map((item) => this.mapAccount(item)),
      total,
      page,
      pageSize,
      summary,
    };
  }

  async getAccountById(accountId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        email: true,
        gender: true,
        role: true,
        avatarUrl: true,
        address: true,
        isActive: true,
        isVerified: true,
        isOnline: true,
        lastLogin: true,
        createdAt: true,
        latitude: true,
        longitude: true,
        _count: {
          select: {
            devices: true,
            chatSessions: true,
            technicianSessions: true,
            reviewsGiven: true,
            reviewsReceived: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return this.mapAccount(user);
  }
}
