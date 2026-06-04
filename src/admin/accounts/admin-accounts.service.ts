import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdminAccountDto } from './dto/create-admin-account.dto';
import { UpdateAdminAccountDto } from './dto/update-admin-account.dto';

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

  private readonly saltRounds = 10;

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

  private normalizeOptionalString(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeOptionalNumber(value?: number | null) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private async loadAccountByIdOrNull(accountId: number) {
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

    return user ? this.mapAccount(user) : null;
  }

  async createAccount(payload: CreateAdminAccountDto) {
    const phoneNumber = payload.phoneNumber.trim();
    const email = this.normalizeOptionalString(payload.email);

    const existedByPhone = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (existedByPhone) {
      throw new ConflictException('Số điện thoại đã tồn tại.');
    }

    if (email) {
      const existedByEmail = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existedByEmail) {
        throw new ConflictException('Email đã tồn tại.');
      }
    }

    const hashedPassword = await bcrypt.hash(payload.password, this.saltRounds);

    const created = await this.prisma.user.create({
      data: {
        phoneNumber,
        password: hashedPassword,
        fullName: this.normalizeOptionalString(payload.fullName),
        gender: payload.gender ?? Gender.OTHER,
        email,
        avatarUrl: this.normalizeOptionalString(payload.avatarUrl),
        address: this.normalizeOptionalString(payload.address),
        role: payload.role ?? UserRole.USER,
        isVerified: payload.isVerified ?? false,
        isActive: payload.isActive ?? true,
        latitude: this.normalizeOptionalNumber(payload.latitude),
        longitude: this.normalizeOptionalNumber(payload.longitude),
      },
      select: { id: true },
    });

    const account = await this.loadAccountByIdOrNull(created.id);
    if (!account) {
      throw new NotFoundException('Không thể tải lại tài khoản vừa tạo.');
    }

    return account;
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
    return this.loadAccountByIdOrNull(accountId);
  }

  async updateAccount(accountId: number, payload: UpdateAdminAccountDto) {
    const current = await this.prisma.user.findUnique({
      where: { id: accountId },
      select: { id: true, email: true },
    });

    if (!current) {
      return null;
    }

    const nextEmail = payload.email === undefined ? undefined : this.normalizeOptionalString(payload.email);

    if (nextEmail && nextEmail !== current.email) {
      const existedByEmail = await this.prisma.user.findUnique({
        where: { email: nextEmail },
        select: { id: true },
      });

      if (existedByEmail && existedByEmail.id !== accountId) {
        throw new ConflictException('Email đã tồn tại.');
      }
    }

    await this.prisma.user.update({
      where: { id: accountId },
      data: {
        fullName: payload.fullName !== undefined ? this.normalizeOptionalString(payload.fullName) : undefined,
        gender: payload.gender,
        email: nextEmail,
        avatarUrl: payload.avatarUrl !== undefined ? this.normalizeOptionalString(payload.avatarUrl) : undefined,
        address: payload.address !== undefined ? this.normalizeOptionalString(payload.address) : undefined,
        isVerified: payload.isVerified,
        isActive: payload.isActive,
        latitude: payload.latitude !== undefined ? this.normalizeOptionalNumber(payload.latitude) : undefined,
        longitude: payload.longitude !== undefined ? this.normalizeOptionalNumber(payload.longitude) : undefined,
      },
    });

    return this.loadAccountByIdOrNull(accountId);
  }
}
