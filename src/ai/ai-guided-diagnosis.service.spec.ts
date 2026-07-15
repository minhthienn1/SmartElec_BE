import { AiGuidedDiagnosisService } from './ai-guided-diagnosis.service';

describe('AiGuidedDiagnosisService', () => {
  const service = new AiGuidedDiagnosisService();

  it('hỏi đúng bộ 3 câu cho nhóm WATER_APPLIANCE', () => {
    const result = service.resolveNextStep({
      originalText: 'máy rửa bát bị lỗi không xả nước',
      prevState: null,
      intentGate: {
        intent: 'TECHNICAL_SPECIFIC',
        detectedDeviceLabel: 'Máy rửa bát',
        detectedIssueLabel: 'Không xả nước',
        supportedDeviceCategory: 'WATER_APPLIANCE',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.state?.phase).toBe('ASKING_CONTEXT');
    expect(result.parsedResponse?.state?.deviceCategory).toBe('WATER_APPLIANCE');
    expect(result.parsedResponse?.state?.contextQuestionsAsked).toBe(true);
    expect(result.parsedResponse?.state?.contextQuestionSet).toContain(
      'WATER_APPLIANCE',
    );
    expect(result.parsedResponse?.text).toContain('1.');
    expect(result.parsedResponse?.text).toContain('xả nước');
  });

  it('hỏi lại thiết bị nếu chỉ biết symptom mà chưa biết device', () => {
    const result = service.resolveNextStep({
      originalText: 'nó không lạnh',
      prevState: null,
      intentGate: {
        intent: 'TECHNICAL_VAGUE',
        detectedDeviceLabel: null,
        detectedIssueLabel: 'Không lạnh',
        supportedDeviceCategory: 'UNKNOWN',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.state?.phase).toBe('COLLECTING');
    expect(result.parsedResponse?.text).toContain('thiết bị nào');
    expect(result.parsedResponse?.state?.contextQuestionsAsked).not.toBe(true);
    expect(result.parsedResponse?.state?.flags).toContain(
      'NEEDS_DEVICE_CONFIRMATION',
    );
  });

  it('hỏi xác nhận khi device và symptom mâu thuẫn', () => {
    const result = service.resolveNextStep({
      originalText: 'máy giặt bị lạnh',
      prevState: null,
      intentGate: {
        intent: 'TECHNICAL_VAGUE',
        detectedDeviceLabel: 'Máy giặt',
        detectedIssueLabel: 'Không lạnh',
        supportedDeviceCategory: 'WATER_APPLIANCE',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.text).toContain('máy giặt');
    expect(result.parsedResponse?.text).toContain('máy lạnh');
    expect(result.parsedResponse?.state?.flags).toContain(
      'DEVICE_SYMPTOM_CONFLICT',
    );
    expect(result.parsedResponse?.state?.device).toBeNull();
  });

  it('chỉ hỏi 1 follow-up quan trọng thay vì lặp lại cả bộ 3 câu', () => {
    const result = service.resolveNextStep({
      originalText: 'dàn lạnh có gió',
      prevState: {
        device: 'Điều hòa',
        symptom: 'Không lạnh',
        deviceCategory: 'COOLING_HEATING',
        phase: 'ASKING_CONTEXT',
        risk: 'UNKNOWN',
        flags: [],
        contextQuestionsAsked: true,
        contextQuestionSet: 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL',
        contextAnswers: {},
      },
      intentGate: {
        intent: 'TECHNICAL_VAGUE',
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        supportedDeviceCategory: 'UNKNOWN',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.state?.askedFollowupKey).toBe(
      'outdoorUnitStatus',
    );
    expect(result.parsedResponse?.text).toContain('cục nóng');
    expect(result.parsedResponse?.text).not.toContain('1.');
    expect(result.parsedResponse?.text).not.toContain('2.');
  });

  it('chuyển sang RAG khi đã có context đủ tín hiệu', () => {
    const result = service.resolveNextStep({
      originalText: 'dàn lạnh có gió, cục nóng không chạy',
      prevState: {
        device: 'Điều hòa',
        symptom: 'Không lạnh',
        deviceCategory: 'COOLING_HEATING',
        phase: 'ASKING_CONTEXT',
        risk: 'UNKNOWN',
        flags: [],
        contextQuestionsAsked: true,
        contextQuestionSet: 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL',
        contextAnswers: {},
      },
      intentGate: {
        intent: 'TECHNICAL_VAGUE',
        detectedDeviceLabel: null,
        detectedIssueLabel: null,
        supportedDeviceCategory: 'UNKNOWN',
      },
    });

    expect(result.action).toBe('USE_RAG');
    expect(result.nextState?.phase).toBe('READY_FOR_RAG');
    expect(result.ragQuery).toContain('Điều hòa');
    expect(result.ragQuery).toContain('Không lạnh');
    expect(result.nextState?.contextAnswers?.operationStatus).toContain(
      'cục nóng không chạy',
    );
  });

  it('chặn device switch ở backend deterministic flow', () => {
    const result = service.resolveNextStep({
      originalText: 'máy giặt tui bị hư',
      prevState: {
        device: 'Điều hòa',
        symptom: 'Không lạnh',
        deviceCategory: 'COOLING_HEATING',
        phase: 'ASKING_CONTEXT',
        risk: 'UNKNOWN',
        flags: [],
      },
      intentGate: {
        intent: 'TECHNICAL_VAGUE',
        detectedDeviceLabel: 'Máy giặt',
        detectedIssueLabel: 'Bị hư',
        supportedDeviceCategory: 'WATER_APPLIANCE',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.text).toContain('Điều hòa');
    expect(result.parsedResponse?.text).toContain('Máy giặt');
    expect(result.parsedResponse?.state?.device).toBe('Điều hòa');
    expect(result.parsedResponse?.state?.flags).toContain(
      'DEVICE_SWITCH_DETECTED',
    );
  });

  it('ưu tiên cảnh báo an toàn trước khi hỏi context', () => {
    const result = service.resolveNextStep({
      originalText: 'lò vi sóng không nóng, có mùi khét và tia lửa',
      prevState: null,
      intentGate: {
        intent: 'TECHNICAL_SPECIFIC',
        detectedDeviceLabel: 'Lò vi sóng',
        detectedIssueLabel: 'Không nóng',
        supportedDeviceCategory: 'COOKING_APPLIANCE',
      },
    });

    expect(result.action).toBe('DIRECT_RESPONSE');
    expect(result.parsedResponse?.state?.risk).toBe('RED');
    expect(result.parsedResponse?.text.startsWith('Bạn nên ngắt nguồn')).toBe(true);
    expect(result.parsedResponse?.state?.contextAnswers?.safetySigns).toContain(
      'mùi khét',
    );
  });
});
