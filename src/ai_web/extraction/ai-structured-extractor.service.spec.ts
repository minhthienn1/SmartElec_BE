import { AiStructuredExtractorService } from './ai-structured-extractor.service';

describe('AiStructuredExtractorService', () => {
  const aiGeminiService = {
    generateStructuredJson: jest.fn(),
  };

  const service = new AiStructuredExtractorService(
    aiGeminiService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('không gọi extractor khi rule đã bắt rõ device và symptom', async () => {
    const result = await service.extract({
      originalText: 'máy lạnh không lạnh',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: 'Điều hòa',
        detectedIssueLabel: 'Không lạnh',
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(result).toBeNull();
    expect(aiGeminiService.generateStructuredJson).not.toHaveBeenCalled();
  });

  it('gọi extractor cho câu dài vòng vo và normalize JSON trả về', async () => {
    aiGeminiService.generateStructuredJson.mockResolvedValue(
      JSON.stringify({
        device: 'Máy rửa bát',
        symptom: 'Không xả nước',
        deviceCategory: 'WATER_APPLIANCE',
        contextAnswers: {
          operationStatus: 'vẫn có đèn, máy chạy nhưng nước không thoát',
          whenHappens: 'hôm qua mới dời chỗ',
        },
        confidence: {
          device: 0.93,
          symptom: 0.9,
          context: 0.82,
          overall: 0.9,
        },
      }),
    );

    const result = await service.extract({
      originalText:
        'Nhà tui dùng cái máy này cũng lâu rồi, hôm qua mới dời chỗ, bật lên vẫn có đèn, nghe tiếng chạy nhưng nước không thoát ra, hình như là máy rửa bát.',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(aiGeminiService.generateStructuredJson).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      device: 'Máy rửa bát',
      symptom: 'Không xả nước',
      deviceCategory: 'WATER_APPLIANCE',
      contextAnswers: {
        operationStatus: 'vẫn có đèn, máy chạy nhưng nước không thoát',
        whenHappens: 'hôm qua mới dời chỗ',
      },
      confidence: {
        device: 0.93,
        symptom: 0.9,
        context: 0.82,
        overall: 0.9,
      },
    });
  });

  it('fallback null nếu parse JSON lỗi', async () => {
    aiGeminiService.generateStructuredJson.mockResolvedValue('not-json');

    const result = await service.extract({
      originalText:
        'máy lạnh nhà tui bật cả tiếng mà phòng vẫn hầm hầm, gió thì có thổi ra mà chẳng thấy mát gì',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(result).toBeNull();
  });

  it('giữ thiết bị chính và detectedOtherDevices khi có nhiều thiết bị nhưng user ưu tiên một cái', async () => {
    aiGeminiService.generateStructuredJson.mockResolvedValue(
      JSON.stringify({
        device: 'Điều hòa',
        symptom: 'Không lạnh',
        detectedOtherDevices: ['Máy giặt'],
        flags: ['MULTIPLE_DEVICES_DETECTED'],
        confidence: {
          device: 0.92,
          symptom: 0.89,
          overall: 0.9,
        },
      }),
    );

    const result = await service.extract({
      originalText:
        'Máy lạnh nhà tui không lạnh, tiện thể máy giặt cũng bị hư nữa, nhưng giờ tui muốn hỏi máy lạnh trước.',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(result?.device).toBe('Điều hòa');
    expect(result?.detectedOtherDevices).toEqual(['Máy giặt']);
    expect(result?.flags).toBeUndefined();
  });

  it('trả clarification cho nhiều thiết bị nếu không rõ thiết bị chính', async () => {
    aiGeminiService.generateStructuredJson.mockResolvedValue(
      JSON.stringify({
        flags: ['MULTIPLE_DEVICES_DETECTED'],
        needsClarification: true,
        clarificationQuestion: 'Bạn muốn mình xử lý thiết bị nào trước: máy lạnh, máy giặt hay tủ lạnh?',
        confidence: {
          overall: 0.72,
        },
      }),
    );

    const result = await service.extract({
      originalText:
        'Máy lạnh không lạnh, máy giặt không vắt, tủ lạnh cũng yếu nữa.',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(result?.needsClarification).toBe(true);
    expect(result?.flags).toContain('MULTIPLE_DEVICES_DETECTED');
    expect(result?.clarificationQuestion).toContain('thiết bị nào trước');
  });

  it('không cần gọi LLM nếu heuristic đã xác định nhiều thiết bị nhưng chưa rõ thiết bị chính', async () => {
    const result = await service.extract({
      originalText:
        'may lanh khong lanh, may giat khong vat, tu lanh cung yeu nua',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: 'Điều hòa',
        detectedIssueLabel: 'Không lạnh',
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(aiGeminiService.generateStructuredJson).not.toHaveBeenCalled();
    expect(result?.needsClarification).toBe(true);
    expect(result?.flags).toContain('MULTIPLE_DEVICES_DETECTED');
    expect(result?.clarificationQuestion).toContain('máy lạnh');
    expect(result?.clarificationQuestion).toContain('máy giặt');
    expect(result?.clarificationQuestion).toContain('tủ lạnh');
  });

  it('không cần gọi LLM nếu heuristic đã xác định thiết bị ưu tiên rõ ràng', async () => {
    const result = await service.extract({
      originalText:
        'may lanh nha tui khong lanh, tien the may giat cung bi hu nua, nhung gio tui muon hoi may lanh truoc',
      prevState: null,
      intentGate: {
        detectedDeviceLabel: 'Điều hòa',
        detectedIssueLabel: 'Không lạnh',
        detectedErrorCode: null,
        isEmergency: false,
      },
    });

    expect(aiGeminiService.generateStructuredJson).not.toHaveBeenCalled();
    expect(result?.device).toBe('Điều hòa');
    expect(result?.detectedOtherDevices).toEqual(['Máy giặt']);
    expect(result?.needsClarification).not.toBe(true);
  });
});
