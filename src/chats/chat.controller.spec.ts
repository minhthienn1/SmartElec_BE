import { MessageType } from '@prisma/client';
import { ChatController } from './chat.controller';

describe('ChatController legacy upload compatibility', () => {
  const uploadService = {
    uploadMediaToR2: jest.fn(),
  };

  const chatsService = {
    assertCanAccessSession: jest.fn(),
    detectDeviceSwitchForSession: jest.fn(),
    processSessionMessage: jest.fn(),
    sendMessage: jest.fn(),
  };

  let controller: ChatController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ChatController(uploadService as any, chatsService as any);
  });

  it('keeps legacy mode by default and does not run device switch precheck', async () => {
    uploadService.uploadMediaToR2.mockResolvedValue('https://cdn.example/legacy.jpg');
    chatsService.sendMessage.mockResolvedValue({ id: 99, type: MessageType.IMAGE });

    const result = await controller.uploadMedia(
      {
        originalname: 'legacy.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File,
      '15',
      'máy giặt',
      undefined,
      undefined,
      {
        user: { id: 7, role: 'USER' },
        headers: {},
      },
    );

    expect(chatsService.detectDeviceSwitchForSession).not.toHaveBeenCalled();
    expect(chatsService.sendMessage).toHaveBeenCalledWith(
      15,
      7,
      expect.objectContaining({
        type: MessageType.IMAGE,
        deviceType: 'máy giặt',
      }),
    );
    expect(result).toMatchObject({
      success: true,
      url: 'https://cdn.example/legacy.jpg',
      type: MessageType.IMAGE,
    });
  });

  it('enables session-v2 mode from header and returns device switch payload before upload', async () => {
    chatsService.detectDeviceSwitchForSession.mockResolvedValue({
      deviceSwitchDetected: true,
      currentDevice: 'lò vi sóng',
      detectedDevice: 'máy giặt',
      originalContent: 'switch.jpg',
      message: 'switch',
      actions: [],
    });

    const result = await controller.uploadMedia(
      {
        originalname: 'switch.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
      } as Express.Multer.File,
      '18',
      'máy giặt',
      undefined,
      undefined,
      {
        user: { id: 7, role: 'USER' },
        headers: { 'x-chat-flow': 'session-v2' },
      },
    );

    expect(chatsService.detectDeviceSwitchForSession).toHaveBeenCalledWith(
      18,
      7,
      'USER',
      {
        deviceType: 'máy giặt',
        content: 'switch.jpg',
      },
    );
    expect(uploadService.uploadMediaToR2).not.toHaveBeenCalled();
    expect(chatsService.processSessionMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deviceSwitchDetected: true,
      detectedDevice: 'máy giặt',
    });
  });
});
