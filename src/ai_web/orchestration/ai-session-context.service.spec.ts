import { AiSessionContextService } from './ai-session-context.service';

describe('AiSessionContextService', () => {
  const prisma = {
    chatSession: { findUnique: jest.fn() },
    device: { findMany: jest.fn() },
  };
  const service = new AiSessionContextService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not query a session when session id is missing', async () => {
    await expect(service.getSessionContext(null)).resolves.toBeNull();
    expect(prisma.chatSession.findUnique).not.toHaveBeenCalled();
  });

  it('seeds missing state fields without overwriting existing values', () => {
    expect(service.seedPreviousState(
      { device: 'Điều hòa' },
      { deviceType: 'Máy giặt', symptom: 'không vắt', aiSummary: 'Tóm tắt' },
    )).toMatchObject({
      device: 'Điều hòa',
      symptom: 'không vắt',
      aiSummaryText: 'Tóm tắt',
    });
  });

  it('builds registered device context for Gemini', async () => {
    prisma.device.findMany.mockResolvedValue([
      { category: 'Điều hòa', brandName: 'Daikin', modelCode: 'A1' },
    ]);
    await expect(service.buildDeviceContext(1)).resolves.toContain(
      'Daikin Điều hòa (A1)',
    );
  });
});
