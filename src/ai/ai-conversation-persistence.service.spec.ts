import { AiConversationPersistenceService } from './ai-conversation-persistence.service';

describe('AiConversationPersistenceService feedback idempotency', () => {
  const prisma = {
    aiReasoningLog: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: AiConversationPersistenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiConversationPersistenceService(prisma as never);
  });

  it('returns existing feedback without updating score when the log was already rated', async () => {
    prisma.aiReasoningLog.findUnique.mockResolvedValue({
      id: 41,
      userId: 7,
      aiFeedback: 'LIKE',
      prevState: null,
      nextState: null,
      aiResponse: 'Da tu van xong.',
    });

    const result = await service.saveFeedback(41, 'DISLIKE');

    expect(prisma.aiReasoningLog.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      feedback: 'LIKE',
      alreadySubmitted: true,
    });
  });
});
