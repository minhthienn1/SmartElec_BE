import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageType } from '@prisma/client';

describe('ChatsService session access and device lock', () => {
  let service: ChatsService;

  const prisma = {
    chatSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    message: {
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    aiReasoningLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const notificationsService = {
    sendNotification: jest.fn(),
  };

  const chatsGateway = {
    server: {
      to: jest.fn(() => ({
        except: jest.fn(() => ({
          emit: jest.fn(),
        })),
        emit: jest.fn(),
      })),
      emit: jest.fn(),
    },
    emitToRoom: jest.fn(),
    emitGlobal: jest.fn(),
  };

  const jobsService = {
    addJobDispatch: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        chatSession: prisma.chatSession,
        message: prisma.message,
      }),
    );

    service = new ChatsService(
      prisma as unknown as PrismaService,
      notificationsService as any,
      chatsGateway as any,
      jobsService as any,
    );
  });

  it('creates a new AI consulting session and persists first message', async () => {
    prisma.chatSession.create.mockResolvedValue({
      id: 11,
      deviceType: 'lò vi sóng',
      symptom: 'không nóng',
      aiSummary: null,
      status: 'AI_CONSULTING',
      technicianId: null,
      createdAt: new Date('2026-06-25T10:00:00.000Z'),
      updatedAt: new Date('2026-06-25T10:00:00.000Z'),
    });
    prisma.message.create.mockResolvedValue({ id: 91 });

    const result = await service.createChatSession(7, {
      deviceType: 'lò vi sóng',
      symptom: 'không nóng',
      firstMessage: 'Lò vi sóng nhà tôi không nóng',
    });

    expect(prisma.chatSession.create).toHaveBeenCalledWith({
      data: {
        userId: 7,
        technicianId: null,
        status: 'AI_CONSULTING',
        deviceType: 'lò vi sóng',
        symptom: 'không nóng',
      },
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        sessionId: 11,
        senderId: 7,
        type: MessageType.TEXT,
        content: 'Lò vi sóng nhà tôi không nóng',
        metadata: {
          contextDevice: 'lò vi sóng',
          contextSymptom: 'không nóng',
        },
      },
    });
    expect(result.title).toBe('lò vi sóng không nóng');
  });

  it('returns a device switch payload and does not persist a user message when device changes', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 15,
      userId: 7,
      technicianId: null,
      deviceType: 'lò vi sóng',
      symptom: 'không nóng',
      status: 'AI_CONSULTING',
    });

    const result = await service.processSessionMessage(
      15,
      7,
      {
        type: MessageType.TEXT,
        content: 'Máy giặt cũng không xả nước',
        deviceType: 'máy giặt',
      },
      'USER',
    );

    expect(result).toMatchObject({
      deviceSwitchDetected: true,
      currentDevice: 'lò vi sóng',
      detectedDevice: 'máy giặt',
      originalContent: 'Máy giặt cũng không xả nước',
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('detects device switch before upload and skips persistence preflight', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 16,
      userId: 7,
      technicianId: null,
      deviceType: 'lÃ² vi sÃ³ng',
      status: 'AI_CONSULTING',
      assignmentHistories: [],
    });

    const result = await service.detectDeviceSwitchForSession(16, 7, 'USER', {
      deviceType: 'mÃ¡y giáº·t',
      content: 'washing-machine.jpg',
    });

    expect(result).toMatchObject({
      deviceSwitchDetected: true,
      currentDevice: 'lÃ² vi sÃ³ng',
      detectedDevice: 'mÃ¡y giáº·t',
      originalContent: 'washing-machine.jpg',
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('allows an assigned technician to access a session and blocks other users', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 21,
      userId: 5,
      technicianId: 9,
      status: 'MATCHED',
    });

    await expect(
      service.assertCanAccessSession(21, 9, 'TECHNICIAN'),
    ).resolves.toBeUndefined();

    await expect(
      service.assertCanAccessSession(21, 99, 'USER'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws not found when asserting access to a missing session', async () => {
    prisma.chatSession.findUnique.mockResolvedValue(null);

    await expect(
      service.assertCanAccessSession(999, 7, 'USER'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create duplicate dispatches when booking is clicked again after session already left AI_CONSULTING', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 31,
      userId: 7,
      technicianId: null,
      status: 'BROADCASTING',
      deviceType: 'Điều hòa',
      symptom: 'Không lạnh',
      contactName: 'Nguyen Van A',
      contactPhone: '0900000000',
      address: 'HCM',
      latitude: null,
      longitude: null,
      createdAt: new Date('2026-07-14T09:00:00.000Z'),
      updatedAt: new Date('2026-07-14T09:01:00.000Z'),
      user: {
        id: 7,
        fullName: 'Nguyen Van A',
        avatarUrl: null,
      },
    });

    const result = await service.bookTechnicianFromSession(31, 7, 'USER', {
      contactName: 'Nguyen Van A',
    });

    expect(prisma.chatSession.updateMany).not.toHaveBeenCalled();
    expect(jobsService.addJobDispatch).not.toHaveBeenCalled();
    expect(chatsGateway.emitGlobal).not.toHaveBeenCalled();
    expect(result.status).toBe('BROADCASTING');
  });

  it('filters out persisted AI transcript messages once the session leaves AI_CONSULTING', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 43,
      status: 'MATCHED',
      sessionType: 'AI_DIAGNOSIS',
    });
    prisma.message.findMany.mockResolvedValue([
      {
        id: 101,
        sessionId: 43,
        senderId: 10,
        sender: { id: 10, fullName: 'Người dùng', avatarUrl: null, role: 'USER' },
        type: 'TEXT',
        content: 'Tôi có vấn đề',
        metadata: { aiTranscript: true },
        isRead: true,
        isDeleted: false,
        createdAt: new Date('2026-07-23T08:00:00.000Z'),
      },
      {
        id: 102,
        sessionId: 43,
        senderId: null,
        sender: null,
        type: 'TEXT',
        content: 'Đây là trả lời AI',
        metadata: { aiTranscript: true },
        isRead: true,
        isDeleted: false,
        createdAt: new Date('2026-07-23T08:00:01.000Z'),
      },
      {
        id: 103,
        sessionId: 43,
        senderId: 20,
        sender: { id: 20, fullName: 'Thợ', avatarUrl: null, role: 'TECHNICIAN' },
        type: 'TEXT',
        content: 'Tôi đến rồi',
        metadata: null,
        isRead: false,
        isDeleted: false,
        createdAt: new Date('2026-07-23T08:05:00.000Z'),
      },
    ]);

    const result = await service.getMessages(43);

    expect(result).toEqual([
      expect.objectContaining({ id: 103, content: 'Tôi đến rồi' }),
    ]);
    expect(prisma.aiReasoningLog.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty message list for DIRECT_BOOKING sessions even when status is AI_CONSULTING', async () => {
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 42,
      status: 'AI_CONSULTING',
      sessionType: 'DIRECT_BOOKING',
    });
    prisma.message.findMany.mockResolvedValue([]);

    const result = await service.getMessages(42);

    expect(result).toEqual([]);
    expect(prisma.aiReasoningLog.findMany).not.toHaveBeenCalled();
  });
});
