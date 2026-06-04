import { Injectable } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type ChatListQuery = {
  keyword?: string;
  status?: string;
  address?: string;
  technicianName?: string;
  isDangerous?: string;
};

@Injectable()
export class AdminChatsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(query: ChatListQuery): Prisma.ChatSessionWhereInput {
    const where: Prisma.ChatSessionWhereInput = {};
    const and: Prisma.ChatSessionWhereInput[] = [];
    const keyword = query.keyword?.trim();

    if (keyword) {
      const or: Prisma.ChatSessionWhereInput[] = [
        { symptom: { contains: keyword, mode: 'insensitive' } },
        { aiSummary: { contains: keyword, mode: 'insensitive' } },
        { deviceType: { contains: keyword, mode: 'insensitive' } },
        { contactName: { contains: keyword, mode: 'insensitive' } },
        { contactPhone: { contains: keyword, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phoneNumber: { contains: keyword, mode: 'insensitive' } },
            ],
          },
        },
        {
          technician: {
            OR: [
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phoneNumber: { contains: keyword, mode: 'insensitive' } },
            ],
          },
        },
        {
          messages: {
            some: {
              content: { contains: keyword, mode: 'insensitive' },
            },
          },
        },
      ];

      const maybeId = Number(keyword);
      if (Number.isInteger(maybeId) && maybeId > 0) {
        or.push({ id: maybeId });
      }

      and.push({ OR: or });
    }

    if (query.status && this.isJobStatus(query.status)) {
      and.push({ status: query.status });
    }

    if (query.address?.trim()) {
      and.push({
        address: { contains: query.address.trim(), mode: 'insensitive' },
      });
    }

    if (query.technicianName?.trim()) {
      and.push({
        technician: {
          fullName: { contains: query.technicianName.trim(), mode: 'insensitive' },
        },
      });
    }

    if (query.isDangerous === 'true') {
      and.push({ isDangerous: true });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    return where;
  }

  private isJobStatus(value: string): value is JobStatus {
    return [
      'AI_CONSULTING',
      'BROADCASTING',
      'MATCHED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'DONE',
      'CANCELLED',
    ].includes(value);
  }

  private mapSession(session: {
    id: number;
    userId: number;
    technicianId: number | null;
    deviceId: number | null;
    deviceType: string | null;
    symptom: string | null;
    aiSummary: string | null;
    isDangerous: boolean;
    status: JobStatus;
    version: number;
    contactName: string | null;
    contactPhone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    createdAt: Date;
    updatedAt: Date;
    user: { id: number; fullName: string | null; avatarUrl: string | null; role: 'USER' | 'TECHNICIAN' | 'ADMIN' };
    technician: { id: number; fullName: string | null; avatarUrl: string | null; role: 'USER' | 'TECHNICIAN' | 'ADMIN' } | null;
    messages?: Array<{
      id: number;
      sessionId: number;
      senderId: number | null;
      type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'QUOTE_CARD' | 'SYSTEM_LOG' | 'QUOTE_RESPONSE';
      content: string;
      metadata: Prisma.JsonValue | null;
      isRead: boolean;
      isDeleted: boolean;
      createdAt: Date;
      sender: { id: number; fullName: string | null; avatarUrl: string | null; role: 'USER' | 'TECHNICIAN' | 'ADMIN' } | null;
    }>;
  }) {
    return {
      id: session.id,
      userId: session.userId,
      technicianId: session.technicianId,
      deviceId: session.deviceId,
      deviceType: session.deviceType,
      symptom: session.symptom,
      aiSummary: session.aiSummary,
      isDangerous: session.isDangerous,
      status: session.status,
      version: session.version,
      contactName: session.contactName,
      contactPhone: session.contactPhone,
      address: session.address,
      latitude: session.latitude,
      longitude: session.longitude,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      user: session.user,
      technician: session.technician,
      messages: Array.isArray(session.messages)
        ? session.messages.map((message) => ({
            id: message.id,
            sessionId: message.sessionId,
            senderId: message.senderId,
            sender: message.sender,
            type: message.type,
            content: message.content,
            metadata: message.metadata,
            isRead: message.isRead,
            isDeleted: message.isDeleted,
            createdAt: message.createdAt.toISOString(),
          }))
        : undefined,
    };
  }

  async getChats(query: ChatListQuery) {
    const sessions = await this.prisma.chatSession.findMany({
      where: this.buildWhere(query),
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceId: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        isDangerous: true,
        status: true,
        version: true,
        contactName: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        technician: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            sessionId: true,
            senderId: true,
            type: true,
            content: true,
            metadata: true,
            isRead: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return sessions.map((session) => this.mapSession(session));
  }

  async getChatById(sessionId: number) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        technicianId: true,
        deviceId: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
        isDangerous: true,
        status: true,
        version: true,
        contactName: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        technician: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sessionId: true,
            senderId: true,
            type: true,
            content: true,
            metadata: true,
            isRead: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return session ? this.mapSession(session) : null;
  }
}
