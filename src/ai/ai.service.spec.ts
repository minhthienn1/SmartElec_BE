import { AiService } from './ai.service';

describe('AiService structured extractor integration', () => {
  const prisma = {
    device: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) },
    chatSession: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const ragRetrievalService = {
    findRelevantChunks: jest.fn().mockResolvedValue({ results: [] }),
  };
  const aiIntentGateService = {
    analyze: jest.fn(),
  };
  const aiGuidedDiagnosisService = {
    resolveNextStep: jest.fn(),
  };
  const aiResponseBuilderService = {
    buildDirectParsedResponse: jest.fn(),
    buildNoRagFallback: jest.fn(),
    buildRagContext: jest.fn(),
    prioritizeChunksByErrorCode: jest.fn(),
    sanitizeUserMessage: jest.fn((value: string) => value),
    buildUserPrompt: jest.fn(),
    buildCleanGeminiHistory: jest.fn().mockReturnValue([]),
    normalizeParsedResponse: jest.fn(),
  };
  const aiConversationPersistenceService = {
    getPreviousState: jest.fn().mockResolvedValue(null),
    finalizeDirectResponse: jest.fn(),
    finalizeAiResponse: jest.fn(),
    getGoldenExamples: jest.fn().mockResolvedValue({ golden: [], negative: null }),
  };
  const aiRateLimitService = {
    assertRateLimit: jest.fn(),
  };
  const aiGeminiService = {
    generateRawResponse: jest.fn(),
  };
  const aiStructuredExtractorService = {
    extract: jest.fn(),
  };

  const service = new AiService(
    prisma as never,
    ragRetrievalService as never,
    aiIntentGateService as never,
    aiGuidedDiagnosisService as never,
    aiResponseBuilderService as never,
    aiConversationPersistenceService as never,
    aiRateLimitService as never,
    aiGeminiService as never,
    aiStructuredExtractorService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    aiConversationPersistenceService.getPreviousState.mockResolvedValue(null);
  });

  it('không gọi extractor khi rule đã có device và symptom rõ ràng', async () => {
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: 'Điều hòa',
      detectedIssueLabel: 'Không lạnh',
      supportedDeviceCategory: 'COOLING_HEATING',
      isTechnical: true,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'TECHNICAL_SPECIFIC',
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'ok',
        state: { phase: 'ASKING_CONTEXT', risk: 'UNKNOWN', flags: [] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'ok',
    });

    await service.chatWithAI(7, 'máy lạnh không lạnh', null);

    expect(aiStructuredExtractorService.extract).not.toHaveBeenCalled();
    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        intentGate: expect.objectContaining({
          detectedDeviceLabel: 'Điều hòa',
          detectedIssueLabel: 'Không lạnh',
        }),
      }),
    );
  });

  it('enrich intent gate và prevState từ extractor cho câu dài vòng vo', async () => {
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: null,
      detectedIssueLabel: null,
      supportedDeviceCategory: 'UNKNOWN',
      isTechnical: false,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'NORMAL',
    });
    aiStructuredExtractorService.extract.mockResolvedValue({
      device: 'Máy rửa bát',
      symptom: 'Không xả nước',
      deviceCategory: 'WATER_APPLIANCE',
      contextAnswers: {
        operationStatus: 'vẫn có đèn, máy chạy nhưng nước không thoát',
        whenHappens: 'hôm qua mới dời chỗ',
      },
      confidence: {
        device: 0.91,
        symptom: 0.9,
        context: 0.82,
        overall: 0.9,
      },
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'ok',
        state: { phase: 'ASKING_CONTEXT', risk: 'UNKNOWN', flags: [] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'ok',
    });

    await service.chatWithAI(
      7,
      'Nhà tui dùng cái máy này cũng lâu rồi, hôm qua mới dời chỗ, bật lên vẫn có đèn, nghe tiếng chạy nhưng nước không thoát ra, hình như là máy rửa bát.',
      null,
    );

    expect(aiStructuredExtractorService.extract).toHaveBeenCalledTimes(1);
    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        prevState: expect.objectContaining({
          contextAnswers: expect.objectContaining({
            operationStatus: 'vẫn có đèn, máy chạy nhưng nước không thoát',
            whenHappens: 'hôm qua mới dời chỗ',
          }),
        }),
        intentGate: expect.objectContaining({
          isTechnical: true,
          detectedDeviceLabel: 'Máy rửa bát',
          detectedIssueLabel: 'Không xả nước',
          supportedDeviceCategory: 'WATER_APPLIANCE',
        }),
      }),
    );
  });

  it('không cho extractor confidence thấp ghi đè device hiện tại', async () => {
    aiConversationPersistenceService.getPreviousState.mockResolvedValue({
      device: 'Điều hòa',
      phase: 'COLLECTING',
      risk: 'UNKNOWN',
      flags: [],
    });
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: null,
      detectedIssueLabel: null,
      supportedDeviceCategory: 'UNKNOWN',
      isTechnical: true,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'TECHNICAL_VAGUE',
    });
    aiStructuredExtractorService.extract.mockResolvedValue({
      device: 'Máy giặt',
      symptom: 'Không xả nước',
      confidence: {
        device: 0.4,
        symptom: 0.62,
        overall: 0.52,
      },
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'ok',
        state: { phase: 'COLLECTING', risk: 'UNKNOWN', flags: [] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'ok',
    });

    await service.chatWithAI(7, 'máy giặt tui bị hư', 21);

    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        intentGate: expect.objectContaining({
          detectedDeviceLabel: null,
        }),
        prevState: expect.objectContaining({
          device: 'Điều hòa',
        }),
      }),
    );
  });

  it('không gọi extractor khi session hiện tại đã có device khác rõ ràng', async () => {
    aiConversationPersistenceService.getPreviousState.mockResolvedValue({
      device: 'Điều hòa',
      phase: 'COLLECTING',
      risk: 'UNKNOWN',
      flags: [],
    });
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: 'Máy giặt',
      detectedIssueLabel: null,
      supportedDeviceCategory: 'WATER_APPLIANCE',
      isTechnical: true,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'TECHNICAL_VAGUE',
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'switch',
        state: { phase: 'COLLECTING', risk: 'UNKNOWN', flags: [] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'switch',
    });

    await service.chatWithAI(7, 'máy giặt tui bị hư', 21);

    expect(aiStructuredExtractorService.extract).not.toHaveBeenCalled();
    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        prevState: expect.objectContaining({
          device: 'Điều hòa',
        }),
        intentGate: expect.objectContaining({
          detectedDeviceLabel: 'Máy giặt',
        }),
      }),
    );
  });

  it('ưu tiên clarification khi có nhiều thiết bị nhưng chưa rõ thiết bị chính', async () => {
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: 'Điều hòa',
      detectedIssueLabel: 'Không lạnh',
      supportedDeviceCategory: 'COOLING_HEATING',
      isTechnical: true,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'TECHNICAL_SPECIFIC',
    });
    aiStructuredExtractorService.extract.mockResolvedValue({
      flags: ['MULTIPLE_DEVICES_DETECTED'],
      needsClarification: true,
      clarificationQuestion:
        'Bạn muốn mình xử lý thiết bị nào trước: máy lạnh, máy giặt hay tủ lạnh?',
      confidence: {
        overall: 0.84,
      },
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'clarify',
        state: { phase: 'COLLECTING', risk: 'UNKNOWN', flags: ['MULTIPLE_DEVICES_DETECTED'] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'clarify',
    });

    await service.chatWithAI(
      7,
      'may lanh khong lanh, may giat khong vat, tu lanh cung yeu nua.',
      null,
    );

    expect(aiStructuredExtractorService.extract).toHaveBeenCalledTimes(1);
    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        prevState: expect.objectContaining({
          clarificationQuestion:
            'Bạn muốn mình xử lý thiết bị nào trước: máy lạnh, máy giặt hay tủ lạnh?',
          flags: expect.arrayContaining(['MULTIPLE_DEVICES_DETECTED']),
        }),
        intentGate: expect.objectContaining({
          detectedDeviceLabel: null,
          detectedIssueLabel: null,
        }),
      }),
    );
  });

  it('giữ thiết bị chính khi user nói rõ muốn hỏi trước', async () => {
    aiIntentGateService.analyze.mockReturnValue({
      detectedDeviceLabel: 'Điều hòa',
      detectedIssueLabel: 'Không lạnh',
      supportedDeviceCategory: 'COOLING_HEATING',
      isTechnical: true,
      shouldReturnDirectResponse: false,
      shouldUseRag: false,
      intent: 'TECHNICAL_SPECIFIC',
    });
    aiStructuredExtractorService.extract.mockResolvedValue({
      device: 'Điều hòa',
      symptom: 'Không lạnh',
      detectedOtherDevices: ['Máy giặt'],
      flags: ['MULTIPLE_DEVICES_DETECTED'],
      confidence: {
        device: 0.91,
        symptom: 0.88,
        overall: 0.9,
      },
    });
    aiGuidedDiagnosisService.resolveNextStep.mockReturnValue({
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: 'main-device',
        state: { phase: 'ASKING_CONTEXT', risk: 'UNKNOWN', flags: [] },
        is_booking_triggered: false,
      },
    });
    aiConversationPersistenceService.finalizeDirectResponse.mockResolvedValue({
      text: 'main-device',
    });

    await service.chatWithAI(
      7,
      'may lanh nha tui khong lanh, tien the may giat cung bi hu nua, nhung gio tui muon hoi may lanh truoc',
      null,
    );

    expect(aiStructuredExtractorService.extract).toHaveBeenCalledTimes(1);
    expect(aiGuidedDiagnosisService.resolveNextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        prevState: expect.objectContaining({
          detectedOtherDevices: ['Máy giặt'],
        }),
        intentGate: expect.objectContaining({
          detectedDeviceLabel: 'Điều hòa',
          detectedIssueLabel: 'Không lạnh',
        }),
      }),
    );
  });
});
