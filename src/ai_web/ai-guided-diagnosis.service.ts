import { Injectable } from '@nestjs/common';

export type DeviceCategory =
  | 'COOLING_HEATING'
  | 'WATER_APPLIANCE'
  | 'COOKING_APPLIANCE'
  | 'DISPLAY_AUDIO'
  | 'CLEANING_APPLIANCE'
  | 'AIR_WATER_TREATMENT'
  | 'GENERIC_APPLIANCE';

export type ContextAnswerKey =
  | 'operationStatus'
  | 'errorCode'
  | 'abnormalSigns'
  | 'brandModel'
  | 'whenHappens'
  | 'maintenanceHistory'
  | 'environmentCondition'
  | 'safetySigns'
  | 'outdoorUnitStatus';

export type ContextAnswers = Partial<Record<ContextAnswerKey, string | null>>;

type GuidedDiagnosisInput = {
  originalText: string;
  prevState: Record<string, any> | null;
  intentGate: any;
  ragChunks?: any[];
};

type GuidedParsedResponse = {
  text: string;
  state: Record<string, any>;
  is_booking_triggered: boolean;
};

export type AiGuidedDiagnosisResult =
  | {
      action: 'DIRECT_RESPONSE';
      parsedResponse: GuidedParsedResponse;
      nextState?: null;
      ragQuery?: null;
      safetyWarning?: string | null;
    }
  | {
      action: 'USE_RAG';
      parsedResponse?: null;
      nextState: Record<string, any>;
      ragQuery: string;
      safetyWarning?: string | null;
    };

type QuestionTemplate = {
  intro: string;
  questions: string[];
  followups: Partial<Record<ContextAnswerKey, string>>;
};

const MINIMUM_RAG_CONTEXT_KEYS: ContextAnswerKey[] = [
  'operationStatus',
  'errorCode',
  'abnormalSigns',
  'whenHappens',
  'safetySigns',
];

const TRANSIENT_BLOCKING_FLAGS = new Set([
  'DEVICE_SYMPTOM_CONFLICT',
  'NEEDS_DEVICE_CONFIRMATION',
  'DEVICE_SWITCH_DETECTED',
]);

const SAFETY_PATTERNS: Array<[RegExp, string]> = [
  [/\bboc khoi\b|\bco khoi\b/u, 'Có khói hoặc bốc khói'],
  [/\bmui khet\b/u, 'Có mùi khét'],
  [/\btia lua\b|\bxet lua\b|\bnet lua\b/u, 'Có tia lửa'],
  [/\bro dien\b|\bgiat dien\b|\bchap dien\b/u, 'Có dấu hiệu rò/chập điện'],
  [/\btieng no\b|\bno nho\b/u, 'Có tiếng nổ bất thường'],
  [/\bnuoc .*o dien\b|\bro nuoc gan nguon dien\b/u, 'Nước rò gần nguồn điện'],
];

@Injectable()
export class AiGuidedDiagnosisService {
  resolveNextStep(input: GuidedDiagnosisInput): AiGuidedDiagnosisResult {
    const previousState = input.prevState ?? {};
    const previousDevice = this.cleanText(previousState.device);
    const previousSymptom = this.cleanText(previousState.symptom);
    const previousFlags = this.normalizeFlags(previousState.flags);
    const clarificationQuestion = this.cleanText(
      previousState.clarificationQuestion,
    );
    const currentFlow = previousState.diagnosisFlow;

    if (
      currentFlow?.mode === 'GUIDED_DIAGNOSIS' &&
      currentFlow?.nextAction === 'SUGGEST_BOOKING'
    ) {
      const normalizedText = this.normalizeText(input.originalText);

      if (
        /^(co|co giup toi voi|giup toi voi|ok|dong y|dat tho giup toi|goi tho giup toi)$/.test(
          normalizedText,
        )
      ) {
        return this.buildDirectResponse({
          text: 'Mình đã ghi nhận bạn đồng ý tạo yêu cầu đặt thợ.\n\nMình sẽ chuyển sang bước đặt lịch để bạn điền thông tin liên hệ và thời gian mong muốn.',
          state: {
            ...previousState,
            phase: 'READY_TO_BOOK',
            diagnosisFlow: { ...currentFlow, nextAction: 'END' },
          },
          isBookingTriggered: true,
        });
      }
    }

    if (currentFlow?.mode === 'GUIDED_DIAGNOSIS') {
      return this.continueLegacyFlow(input);
    }

    const detectedDevice = this.cleanText(
      input.intentGate?.detectedDeviceLabel || previousState.device,
    );
    const detectedSymptom = this.normalizeCanonicalSymptom(
      input.intentGate?.detectedIssueLabel ||
        input.intentGate?.detectedErrorCode ||
        previousState.symptom ||
        null,
    );
    const deviceCategory = this.resolveDeviceCategory({
      device: detectedDevice,
      previousCategory: previousState.deviceCategory,
      intentCategory: input.intentGate?.supportedDeviceCategory,
    });

    if (previousDevice && detectedDevice && previousDevice !== detectedDevice) {
      return this.buildDirectResponse({
        text: `Phiên này đang tư vấn cho ${previousDevice}. Vấn đề ${detectedDevice} nên tạo phiên mới để không lẫn thông tin chẩn đoán.`,
        state: {
          ...previousState,
          device: previousDevice,
          flags: [...previousFlags, 'DEVICE_SWITCH_DETECTED'],
        },
      });
    }

    if (
      !detectedDevice &&
      clarificationQuestion &&
      previousFlags.includes('MULTIPLE_DEVICES_DETECTED')
    ) {
      return this.buildDirectResponse({
        text: clarificationQuestion,
        state: {
          ...previousState,
          phase: 'COLLECTING',
          contextQuestionsAsked: false,
          contextQuestionSet: null,
          askedFollowupKey: null,
          flags: previousFlags,
        },
      });
    }

    if (!detectedDevice) {
      const followup = detectedSymptom
        ? `Bạn đang nói thiết bị nào bị ${detectedSymptom.toLowerCase()}: máy lạnh, tủ lạnh hay thiết bị khác?`
        : 'Bạn cho mình biết thiết bị nào đang gặp lỗi để mình hỏi đúng hướng nhé.';

      return this.buildDirectResponse({
        text: followup,
        state: {
          ...previousState,
          device: previousDevice || null,
          symptom: detectedSymptom || previousSymptom || null,
          phase: 'COLLECTING',
          deviceCategory:
            previousState.deviceCategory || this.toKnownCategory(deviceCategory),
          flags: [...previousFlags, 'NEEDS_DEVICE_CONFIRMATION'],
          contextQuestionsAsked: false,
          contextQuestionSet: null,
          askedFollowupKey: null,
        },
      });
    }

    if (this.isContradictoryDeviceSymptom(detectedDevice, detectedSymptom)) {
      return this.buildDirectResponse({
        text: 'Bạn đang nói “máy giặt” hay “máy lạnh” vậy ạ? Vì lỗi “không lạnh/bị lạnh” thường gặp ở máy lạnh hoặc tủ lạnh, còn máy giặt thường liên quan cấp nước, xả nước, vắt hoặc không lên nguồn.',
        state: {
          ...previousState,
          device: previousDevice || null,
          symptom: detectedSymptom || previousSymptom || null,
          phase: 'COLLECTING',
          deviceCategory: previousDevice
            ? this.toKnownCategory(deviceCategory)
            : previousState.deviceCategory || null,
          flags: [
            ...previousFlags,
            'DEVICE_SYMPTOM_CONFLICT',
            'NEEDS_DEVICE_CONFIRMATION',
          ],
          contextQuestionsAsked: false,
          contextQuestionSet: null,
          askedFollowupKey: null,
        },
      });
    }

    const questionSet = this.buildContextQuestionSet(
      detectedDevice,
      this.toKnownCategory(deviceCategory),
      detectedSymptom,
    );
    const previousQuestionSet = this.cleanText(previousState.contextQuestionSet);
    const questionSetMatches =
      previousState.contextQuestionsAsked === true &&
      Boolean(previousQuestionSet) &&
      previousQuestionSet === questionSet;

    const mergedContextAnswers = this.mergeContextAnswers(
      previousState.contextAnswers,
      this.extractContextAnswers(input.originalText),
    );
    const safetyWarning = this.buildSafetyWarning(
      mergedContextAnswers.safetySigns,
      previousState.risk,
    );

    const baseState = {
      ...previousState,
      device: detectedDevice,
      symptom: detectedSymptom || this.normalizeCanonicalSymptom(previousSymptom) || null,
      deviceCategory: this.toKnownCategory(deviceCategory),
      contextQuestionSet: questionSet,
      contextQuestionsAsked: questionSetMatches,
      contextAnswers: mergedContextAnswers,
      askedFollowupKey: questionSetMatches
        ? previousState.askedFollowupKey || null
        : null,
      risk: mergedContextAnswers.safetySigns
        ? 'RED'
        : previousState.risk || 'UNKNOWN',
      phase: previousState.phase || 'COLLECTING',
      flags: previousFlags,
    };

    if (mergedContextAnswers.safetySigns) {
      return this.buildDirectResponse({
        text: this.prependSafetyIfNeeded(
          `Bạn không nên tiếp tục sử dụng ${detectedDevice.toLowerCase()} lúc này. Ưu tiên đảm bảo an toàn, sau đó nên đặt thợ kiểm tra trực tiếp.`,
          safetyWarning,
        ),
        state: {
          ...baseState,
          phase: 'READY_TO_BOOK',
          contextQuestionsAsked: false,
          contextQuestionSet: null,
          askedFollowupKey: null,
          flags: [...previousFlags, 'SAFETY_WARNING'],
        },
      });
    }

    if (!detectedSymptom) {
      return this.buildDirectResponse({
        text: `Mình đã ghi nhận thiết bị là ${detectedDevice}. Bạn mô tả rõ hơn giúp mình lỗi đang gặp là gì nhé.`,
        state: {
          ...baseState,
          phase: 'COLLECTING',
        },
      });
    }

    const followupKey = this.pickFollowupKey(questionSet, mergedContextAnswers);
    const hasMinimumContext = MINIMUM_RAG_CONTEXT_KEYS.some((key) =>
      this.cleanText(mergedContextAnswers[key]),
    );
    const hasCollectedContext = Object.keys(mergedContextAnswers).length > 0;

    if (!questionSetMatches && hasCollectedContext && followupKey) {
      const followupQuestion =
        this.getQuestionTemplate(questionSet).followups[followupKey];

      if (followupQuestion) {
        return this.buildDirectResponse({
          text: this.prependSafetyIfNeeded(followupQuestion, safetyWarning),
          state: {
            ...baseState,
            contextQuestionsAsked: true,
            phase: 'ASKING_CONTEXT',
            askedFollowupKey: followupKey,
          },
        });
      }
    }

    if (!questionSetMatches && hasCollectedContext && hasMinimumContext) {
      return {
        action: 'USE_RAG',
        nextState: {
          ...baseState,
          contextQuestionsAsked: true,
          phase: 'READY_FOR_RAG',
        },
        ragQuery: this.buildRagQuery({
          device: detectedDevice,
          symptom: detectedSymptom,
          contextAnswers: mergedContextAnswers,
        }),
        safetyWarning,
      };
    }

    if (!questionSetMatches) {
      return this.buildDirectResponse({
        text: this.buildQuestionSetMessage(questionSet),
        state: {
          ...baseState,
          contextQuestionsAsked: true,
          askedFollowupKey: null,
          phase: 'ASKING_CONTEXT',
        },
      });
    }

    if (followupKey) {
      const followupQuestion =
        this.getQuestionTemplate(questionSet).followups[followupKey];

      if (followupQuestion) {
        const prompt =
          previousState.askedFollowupKey === followupKey
            ? `Mình vẫn cần bạn xác nhận giúp mình một ý này: ${followupQuestion}`
            : followupQuestion;

        return this.buildDirectResponse({
          text: this.prependSafetyIfNeeded(prompt, safetyWarning),
          state: {
            ...baseState,
            phase: 'ASKING_CONTEXT',
            askedFollowupKey: followupKey,
          },
        });
      }
    }

    if (hasMinimumContext) {
      return {
        action: 'USE_RAG',
        nextState: {
          ...baseState,
          contextQuestionsAsked: true,
          phase: 'READY_FOR_RAG',
        },
        ragQuery: this.buildRagQuery({
          device: detectedDevice,
          symptom: detectedSymptom,
          contextAnswers: mergedContextAnswers,
        }),
        safetyWarning,
      };
    }

    return this.buildDirectResponse({
      text: this.prependSafetyIfNeeded(
        'Mình cần thêm 1 thông tin quan trọng: lỗi này xuất hiện liên tục hay chỉ lúc có lúc không?',
        safetyWarning,
      ),
      state: {
        ...baseState,
        phase: 'ASKING_CONTEXT',
        askedFollowupKey: 'whenHappens',
      },
    });
  }

  private buildDirectResponse(input: {
    text: string;
    state: Record<string, any>;
    isBookingTriggered?: boolean;
  }): AiGuidedDiagnosisResult {
    return {
      action: 'DIRECT_RESPONSE',
      parsedResponse: {
        text: input.text,
        state: input.state,
        is_booking_triggered: input.isBookingTriggered === true,
      },
      nextState: null,
      ragQuery: null,
    };
  }

  private continueLegacyFlow(input: GuidedDiagnosisInput): AiGuidedDiagnosisResult {
    const oldFlow = input.prevState?.diagnosisFlow;

    const userAnswers = {
      ...(oldFlow?.collectedInfo?.userAnswers || {}),
      [`step_${oldFlow.currentStep}`]: input.originalText,
    };

    const nextStep = Number(oldFlow.currentStep || 1) + 1;

    if (nextStep > 3) {
      const diagnosisFlow = {
        ...oldFlow,
        currentStep: nextStep,
        collectedInfo: {
          ...(oldFlow.collectedInfo || {}),
          userAnswers,
        },
        nextAction: 'SUGGEST_BOOKING',
      };

      return this.buildDirectResponse({
        text: [
          'Mình đã ghi nhận thêm thông tin bạn cung cấp.',
          '',
          'Với tình trạng này, để tránh kiểm tra sai hoặc bỏ sót lỗi phần cứng, bạn nên để kỹ thuật viên kiểm tra trực tiếp.',
          '',
          'Bạn có muốn mình hỗ trợ tạo yêu cầu đặt thợ không?',
        ].join('\n'),
        state: {
          ...input.prevState,
          phase: 'READY_TO_BOOK',
          diagnosisFlow,
        },
      });
    }

    const nextQuestion = this.buildQuestionByStep(
      input.prevState?.device || input.intentGate?.detectedDeviceLabel,
      nextStep,
    );

    const diagnosisFlow = {
      ...oldFlow,
      currentStep: nextStep,
      currentQuestion: nextQuestion,
      askedQuestions: [...(oldFlow.askedQuestions || []), nextQuestion],
      collectedInfo: {
        ...(oldFlow.collectedInfo || {}),
        userAnswers,
      },
      nextAction: 'ASK_ONE_QUESTION',
    };

    return this.buildDirectResponse({
      text: [
        'Mình đã ghi nhận thông tin bạn vừa cung cấp.',
        '',
        `Bước ${nextStep}: ${nextQuestion}`,
      ].join('\n'),
      state: {
        ...input.prevState,
        phase: 'DIAGNOSING',
        diagnosisFlow,
      },
    });
  }

  private buildQuestionByStep(device: string, step: number): string {
    const text = (device || '').toLowerCase();

    if (text.includes('máy lạnh') || text.includes('điều hòa')) {
      if (step === 2) {
        return 'Khi bật máy lạnh, bạn có nghe tiếng cục nóng chạy hoặc thấy quạt cục nóng quay không?';
      }

      return 'Máy lạnh có báo mã lỗi, chớp đèn hoặc có mùi khét gì không?';
    }

    if (text.includes('máy giặt')) {
      if (step === 2) {
        return 'Máy có báo mã lỗi trên màn hình không? Nếu có, mã lỗi là gì?';
      }

      return 'Lỗi này xảy ra liên tục hay chỉ thỉnh thoảng mới bị?';
    }

    if (text.includes('tủ lạnh')) {
      if (step === 2) {
        return 'Bạn có nghe block/máy nén phía sau tủ chạy không?';
      }

      return 'Tủ có đóng tuyết, chảy nước hoặc có mùi khét không?';
    }

    return 'Lỗi này xảy ra liên tục hay chỉ thỉnh thoảng mới bị?';
  }

  private resolveDeviceCategory(input: {
    device: string | null;
    previousCategory?: string | null;
    intentCategory?: string | null;
  }): DeviceCategory | 'UNKNOWN' {
    const device = this.cleanText(input.device).toLowerCase();

    if (device.includes('điều hòa') || device.includes('máy lạnh')) {
      return 'COOLING_HEATING';
    }
    if (
      device.includes('tủ lạnh') ||
      device.includes('tủ đông') ||
      device.includes('máy nước nóng') ||
      device.includes('bình nóng lạnh') ||
      device.includes('máy sấy')
    ) {
      return 'COOLING_HEATING';
    }
    if (
      device.includes('máy giặt') ||
      device.includes('máy rửa bát') ||
      device.includes('máy lọc nước') ||
      device.includes('máy bơm nước')
    ) {
      return 'WATER_APPLIANCE';
    }
    if (
      device.includes('bếp từ') ||
      device.includes('bếp điện') ||
      device.includes('lò vi sóng') ||
      device.includes('lò nướng') ||
      device.includes('nồi chiên') ||
      device.includes('nồi cơm') ||
      device.includes('máy pha cà phê') ||
      device.includes('máy hút mùi')
    ) {
      return 'COOKING_APPLIANCE';
    }
    if (
      device.includes('tivi') ||
      device.includes('màn hình') ||
      device.includes('loa') ||
      device.includes('amply')
    ) {
      return 'DISPLAY_AUDIO';
    }
    if (
      device.includes('máy hút bụi') ||
      device.includes('robot hút bụi') ||
      device.includes('máy lau nhà')
    ) {
      return 'CLEANING_APPLIANCE';
    }
    if (
      device.includes('máy lọc không khí') ||
      device.includes('máy hút ẩm') ||
      device.includes('máy tạo ẩm')
    ) {
      return 'AIR_WATER_TREATMENT';
    }

    if (this.cleanText(input.intentCategory) && input.intentCategory !== 'UNKNOWN') {
      return input.intentCategory as DeviceCategory;
    }

    if (this.cleanText(input.previousCategory)) {
      return input.previousCategory as DeviceCategory;
    }

    return device ? 'GENERIC_APPLIANCE' : 'UNKNOWN';
  }

  private toKnownCategory(value: DeviceCategory | 'UNKNOWN'): DeviceCategory {
    return value === 'UNKNOWN' ? 'GENERIC_APPLIANCE' : value;
  }

  private buildContextQuestionSet(
    device: string,
    category: DeviceCategory,
    symptom: string | null,
  ) {
    const lowerDevice = device.toLowerCase();
    const lowerSymptom = this.normalizeCanonicalSymptom(symptom).toLowerCase();

    if (
      category === 'COOLING_HEATING' &&
      (lowerDevice.includes('điều hòa') || lowerDevice.includes('máy lạnh')) &&
      (lowerSymptom.includes('không lạnh') || lowerSymptom.includes('không mát'))
    ) {
      return 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL';
    }

    if (
      category === 'COOLING_HEATING' &&
      (lowerDevice.includes('tủ lạnh') || lowerDevice.includes('tủ đông'))
    ) {
      return 'COOLING_HEATING::REFRIGERATOR_COOLING';
    }

    return `${category}::GENERIC`;
  }

  private getQuestionTemplate(questionSet: string): QuestionTemplate {
    const templates: Record<string, QuestionTemplate> = {
      'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL': {
        intro: 'Mình cần 3 thông tin để chẩn đoán sát hơn:',
        questions: [
          'Dàn lạnh trong phòng có thổi gió không?',
          'Cục nóng bên ngoài có chạy không?',
          'Máy có báo mã lỗi/chớp đèn, hoặc gần đây có vệ sinh/bơm gas chưa?',
        ],
        followups: {
          outdoorUnitStatus:
            'cục nóng bên ngoài có chạy không? Thông tin này rất quan trọng để phân biệt lỗi gas, quạt/block dàn nóng hay board điều khiển.',
          errorCode:
            'Máy có báo mã lỗi, chớp đèn hoặc gần đây đã vệ sinh/bơm gas chưa?',
        },
      },
      'COOLING_HEATING::REFRIGERATOR_COOLING': {
        intro: 'Mình cần 3 thông tin để kiểm tra đúng lỗi:',
        questions: [
          'Ngăn mát hay ngăn đá đang không lạnh/không đông?',
          'Block/máy nén phía sau có chạy và nóng không?',
          'Ron cửa có hở, quạt có chạy, hoặc tủ có đóng tuyết bất thường không?',
        ],
        followups: {
          operationStatus: 'Hiện ngăn mát hay ngăn đá đang mất lạnh rõ hơn?',
          abnormalSigns:
            'Tủ có đóng tuyết bất thường, quạt yếu hoặc ron cửa hở không?',
        },
      },
      'WATER_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: [
          'Thiết bị đang lỗi ở bước nào: cấp nước, hoạt động chính, xả nước hay không lên nguồn?',
          'Có mã lỗi, đèn nhấp nháy, tiếng lạ, mùi khét, rò nước hoặc nước không thoát không?',
          'Lỗi xảy ra liên tục hay lúc có lúc không, và có xuất hiện sau khi vệ sinh/thay lõi/di chuyển máy không?',
        ],
        followups: {
          operationStatus:
            'Thiết bị đang lỗi rõ nhất ở bước nào: cấp nước, chạy chính hay xả nước?',
          errorCode: 'Thiết bị có mã lỗi hoặc đèn nhấp nháy nào không?',
        },
      },
      'COOKING_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để kiểm tra an toàn hơn:',
        questions: [
          'Thiết bị có lên nguồn/hiển thị bình thường không?',
          'Khi hoạt động có nóng/đun/nướng đúng chức năng không, hay bị yếu/tự ngắt?',
          'Có mã lỗi, tiếng lạ, mùi khét, tia lửa, khói hoặc tự ngắt bất thường không?',
        ],
        followups: {
          operationStatus:
            'Thiết bị có lên nguồn nhưng không nóng, hay không lên nguồn hoàn toàn?',
          safetySigns: 'Có mùi khét, khói hoặc tia lửa khi vận hành không?',
        },
      },
      'DISPLAY_AUDIO::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: [
          'Thiết bị có lên nguồn/đèn báo không?',
          'Lỗi nằm ở hình ảnh, âm thanh, kết nối hay nguồn điện?',
          'Lỗi xảy ra sau va đập, sét, mất điện, cập nhật phần mềm hay đang dùng bình thường?',
        ],
        followups: {
          operationStatus:
            'Thiết bị hiện còn lên nguồn hay hoàn toàn không có đèn báo?',
          whenHappens:
            'Lỗi bắt đầu sau sự kiện nào gần đây như mất điện, va đập hoặc cập nhật?',
        },
      },
      'CLEANING_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: [
          'Thiết bị có lên nguồn và motor/bánh xe/chổi quay còn hoạt động không?',
          'Lỗi là hút yếu, không chạy, kẹt bánh/chổi, báo lỗi cảm biến hay pin sạc không vào?',
          'Có tiếng lạ, mùi khét, bụi/nước rò ra hoặc lỗi xảy ra sau khi vệ sinh máy không?',
        ],
        followups: {
          operationStatus:
            'Máy hiện không chạy hoàn toàn hay vẫn chạy nhưng hút yếu?',
          abnormalSigns: 'Có tiếng lạ, mùi khét hoặc kẹt chổi/bánh xe không?',
        },
      },
      'AIR_WATER_TREATMENT::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: [
          'Thiết bị có lên nguồn và quạt/bơm/cảm biến còn hoạt động không?',
          'Có mã lỗi, đèn báo thay lõi/thay màng lọc, tiếng lạ hoặc mùi bất thường không?',
          'Lỗi xảy ra sau khi thay lõi, vệ sinh, di chuyển máy hay dùng bình thường?',
        ],
        followups: {
          errorCode: 'Thiết bị có đèn báo đỏ, báo thay lõi hoặc mã lỗi nào không?',
          whenHappens:
            'Lỗi xuất hiện sau lần thay lõi/vệ sinh gần nhất hay đang dùng bình thường?',
        },
      },
      'GENERIC_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi chính xác hơn:',
        questions: [
          'Thiết bị còn lên nguồn/chạy được phần nào không?',
          'Có mã lỗi, đèn nhấp nháy, tiếng lạ, mùi khét, rò nước hoặc dấu hiệu bất thường nào không?',
          'Lỗi bắt đầu từ khi nào, xảy ra liên tục hay lúc có lúc không?',
        ],
        followups: {
          operationStatus:
            'Thiết bị hiện còn lên nguồn hoặc hoạt động được phần nào không?',
          whenHappens: 'Lỗi bắt đầu từ khi nào và có xảy ra liên tục không?',
        },
      },
    };

    return templates[questionSet] || templates['GENERIC_APPLIANCE::GENERIC'];
  }

  private buildQuestionSetMessage(questionSet: string) {
    const template = this.getQuestionTemplate(questionSet);

    return [
      template.intro,
      '',
      `1. ${template.questions[0]}`,
      `2. ${template.questions[1]}`,
      `3. ${template.questions[2]}`,
    ].join('\n');
  }

  private extractContextAnswers(originalText: string): ContextAnswers {
    const normalized = this.normalizeText(originalText);
    const errorCodeMatch = originalText.match(/\b[A-Z]{1,3}\s?\d{1,3}\b/i);
    const answers: ContextAnswers = {};

    if (errorCodeMatch?.[0]) {
      answers.errorCode = errorCodeMatch[0].replace(/\s+/g, '').toUpperCase();
    }

    if (
      /dan lanh co gio|cuc nong khong chay|cuc nong co chay|khong len nguon|van chay|hut yeu|khong xa nuoc|khong cap nuoc|den sang|van co den|dia quay|van quay/u.test(
        normalized,
      )
    ) {
      answers.operationStatus = this.extractOperationStatus(originalText, normalized);
    }

    if (
      /tu hom qua|tu hom nay|luc co luc khong|lien tuc|gan day|moi day/u.test(
        normalized,
      )
    ) {
      answers.whenHappens = originalText.trim();
    }

    if (
      /da ve sinh|bom gas|thay loi|thay mang loc|di chuyen may/u.test(normalized)
    ) {
      answers.maintenanceHistory = originalText.trim();
    }

    if (
      /den do|chap nhay|dong tuyet|tieng la|keu to|mui la|ri nuoc|ro nuoc/u.test(
        normalized,
      )
    ) {
      answers.abnormalSigns = originalText.trim();
    }

    const safetySigns = this.detectSafetySigns(normalized);
    if (safetySigns.length > 0) {
      answers.safetySigns = safetySigns.join(', ');
    }

    return answers;
  }

  private extractOperationStatus(originalText: string, normalized: string) {
    const segments: string[] = [];

    if (/dan lanh co gio/u.test(normalized)) {
      segments.push('dàn lạnh có gió');
    }
    if (/cuc nong khong chay/u.test(normalized)) {
      segments.push('cục nóng không chạy');
    }
    if (/cuc nong co chay/u.test(normalized)) {
      segments.push('cục nóng có chạy');
    }
    if (/khong len nguon/u.test(normalized)) {
      segments.push('không lên nguồn');
    }
    if (/den sang|van co den/u.test(normalized)) {
      segments.push('đèn vẫn sáng');
    }
    if (/dia quay|van quay/u.test(normalized)) {
      segments.push('đĩa vẫn quay');
    }
    if (/hut yeu/u.test(normalized)) {
      segments.push('hút yếu');
    }
    if (/khong xa nuoc/u.test(normalized)) {
      segments.push('không xả nước');
    }
    if (/khong cap nuoc/u.test(normalized)) {
      segments.push('không cấp nước');
    }

    return segments.length > 0 ? segments.join(', ') : originalText.trim();
  }

  private mergeContextAnswers(
    previousValue: unknown,
    nextValue: ContextAnswers,
  ): ContextAnswers {
    const previous = this.isPlainObject(previousValue)
      ? (previousValue as ContextAnswers)
      : {};
    const merged: ContextAnswers = { ...previous };

    for (const [key, value] of Object.entries(nextValue) as Array<
      [ContextAnswerKey, string | null | undefined]
    >) {
      if (typeof value === 'string' && value.trim()) {
        merged[key] = value.trim();
      }
    }

    return merged;
  }

  private pickFollowupKey(
    questionSet: string,
    contextAnswers: ContextAnswers,
  ): ContextAnswerKey | null {
    if (questionSet === 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL') {
      const operationStatus = this.cleanText(
        contextAnswers.operationStatus,
      ).toLowerCase();

      if (
        operationStatus.includes('dàn lạnh có gió') &&
        !operationStatus.includes('cục nóng')
      ) {
        return 'outdoorUnitStatus';
      }

      if (operationStatus.includes('cục nóng')) {
        return null;
      }

      if (
        !this.cleanText(contextAnswers.errorCode) &&
        !this.cleanText(contextAnswers.abnormalSigns)
      ) {
        return 'errorCode';
      }

      return null;
    }

    if (questionSet === 'COOKING_APPLIANCE::GENERIC') {
      if (!this.cleanText(contextAnswers.operationStatus)) {
        return 'operationStatus';
      }

      if (!this.cleanText(contextAnswers.safetySigns)) {
        return 'safetySigns';
      }

      return null;
    }

    if (!this.cleanText(contextAnswers.operationStatus)) {
      return 'operationStatus';
    }

    if (
      !this.cleanText(contextAnswers.errorCode) &&
      !this.cleanText(contextAnswers.abnormalSigns)
    ) {
      return 'errorCode';
    }

    return null;
  }

  private buildRagQuery(input: {
    device: string;
    symptom: string;
    contextAnswers: ContextAnswers;
  }) {
    const parts = [input.device, input.symptom];
    const contextValues = [
      input.contextAnswers.operationStatus,
      input.contextAnswers.errorCode,
      input.contextAnswers.abnormalSigns,
      input.contextAnswers.whenHappens,
      input.contextAnswers.safetySigns,
      input.contextAnswers.maintenanceHistory,
      input.contextAnswers.environmentCondition,
      input.contextAnswers.brandModel,
    ]
      .map((value) => this.cleanText(value))
      .filter(Boolean);

    return [...parts, ...contextValues].join(' | ');
  }

  private buildSafetyWarning(
    safetySigns: string | null | undefined,
    risk: unknown,
  ) {
    if (!this.cleanText(safetySigns) && risk !== 'HIGH' && risk !== 'RED') {
      return null;
    }

    return 'Bạn nên ngắt nguồn thiết bị ngay, không tiếp tục sử dụng và không tự tháo nếu chưa có chuyên môn.';
  }

  private prependSafetyIfNeeded(text: string, safetyWarning?: string | null) {
    return safetyWarning ? `${safetyWarning}\n\n${text}` : text;
  }

  private normalizeCanonicalSymptom(value?: string | null) {
    const symptom = this.cleanText(value);
    const normalized = this.normalizeText(symptom);

    if (
      /khong lanh|khong mat|khong lam mat|phong ham ham|chang thay mat/.test(
        normalized,
      )
    ) {
      return 'Không lạnh';
    }

    if (
      /khong nong|khong lam nong|khong lam nong thuc an|do an van nguoi|quay xong van nguoi/.test(
        normalized,
      )
    ) {
      return 'Không nóng';
    }

    return symptom;
  }

  private detectSafetySigns(normalizedText: string) {
    return SAFETY_PATTERNS.filter(([pattern]) => pattern.test(normalizedText)).map(
      ([, label]) => label,
    );
  }

  private isContradictoryDeviceSymptom(
    device: string,
    symptom: string | null,
  ) {
    const lowerDevice = device.toLowerCase();
    const lowerSymptom = this.cleanText(symptom).toLowerCase();

    return (
      lowerDevice.includes('máy giặt') &&
      (lowerSymptom.includes('không lạnh') || lowerSymptom.includes('bị lạnh'))
    );
  }

  private cleanText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeText(value: string) {
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private normalizeFlags(value: unknown) {
    const flags = Array.isArray(value)
      ? value.filter((flag): flag is string => typeof flag === 'string')
      : [];

    return flags.filter((flag) => !TRANSIENT_BLOCKING_FLAGS.has(flag));
  }
}
