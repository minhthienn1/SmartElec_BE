import { Injectable } from '@nestjs/common';
import {
  AiContextCollectorService,
} from '../extraction/ai-context-collector.service';
import { AiQuestionPolicyService } from '../policies/ai-question-policy.service';
import { AiRagPolicyService } from '../policies/ai-rag-policy.service';
import { AiSafetyPolicyService } from '../policies/ai-safety-policy.service';

export type DeviceCategory =
  | 'COOLING_HEATING'
  | 'WATER_APPLIANCE'
  | 'COOKING_APPLIANCE'
  | 'DISPLAY_AUDIO'
  | 'CLEANING_APPLIANCE'
  | 'AIR_WATER_TREATMENT'
  | 'GENERIC_APPLIANCE';

export type {
  ContextAnswerKey,
  ContextAnswers,
} from '../extraction/ai-context-collector.service';

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

const TRANSIENT_BLOCKING_FLAGS = new Set([
  'DEVICE_SYMPTOM_CONFLICT',
  'NEEDS_DEVICE_CONFIRMATION',
  'DEVICE_SWITCH_DETECTED',
]);

@Injectable()
export class AiGuidedDiagnosisService {
  constructor(
    private readonly contextCollector: AiContextCollectorService,
    private readonly questionPolicy: AiQuestionPolicyService,
    private readonly safetyPolicy: AiSafetyPolicyService,
    private readonly ragPolicy: AiRagPolicyService,
  ) {}

  resolveNextStep(input: GuidedDiagnosisInput): AiGuidedDiagnosisResult {
    // Điều phối deterministic toàn bộ lượt chat: giữ state, chặn đổi thiết bị, hỏi context, cảnh báo và gate RAG/booking.
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
    const canonicalPreviousDevice = this.normalizeDeviceKey(previousDevice);
    const canonicalDetectedDevice = this.normalizeDeviceKey(detectedDevice);
    const stableDetectedDevice =
      previousDevice &&
      detectedDevice &&
      canonicalPreviousDevice &&
      canonicalPreviousDevice === canonicalDetectedDevice
        ? previousDevice
        : detectedDevice;
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

    if (
      previousDevice &&
      detectedDevice &&
      canonicalPreviousDevice &&
      canonicalDetectedDevice &&
      canonicalPreviousDevice !== canonicalDetectedDevice
    ) {
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

    const questionSet = this.questionPolicy.buildQuestionSet(
      detectedDevice,
      this.toKnownCategory(deviceCategory),
      detectedSymptom,
    );
    const previousQuestionSet = this.cleanText(previousState.contextQuestionSet);
    const questionSetMatches =
      previousState.contextQuestionsAsked === true &&
      Boolean(previousQuestionSet) &&
      previousQuestionSet === questionSet;

    const mergedContextAnswers = this.contextCollector.merge(
      previousState.contextAnswers,
      this.contextCollector.extract(input.originalText),
    );
    const safetyWarning = this.safetyPolicy.buildWarning(
      mergedContextAnswers.safetySigns,
      previousState.risk,
    );

    const baseState = {
      ...previousState,
      device: stableDetectedDevice,
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
        text: this.safetyPolicy.prepend(
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

    if (!detectedSymptom && previousDevice) {
      return this.buildDirectResponse({
        text: this.questionPolicy.buildMissingSymptomPrompt(
          stableDetectedDevice,
          this.toKnownCategory(deviceCategory),
        ),
        state: {
          ...baseState,
          phase: 'COLLECTING',
        },
      });
    }

    if (!detectedSymptom) {
      return this.buildDirectResponse({
         text: `Mình đã ghi nhận thiết bị là ${stableDetectedDevice}. Bạn mô tả rõ hơn giúp mình lỗi đang gặp là gì nhé.`,
        state: {
          ...baseState,
          phase: 'COLLECTING',
        },
      });
    }

    const followupKey = this.contextCollector.pickFollowupKey(
      questionSet,
      mergedContextAnswers,
    );
    const hasCollectedContext = Object.keys(mergedContextAnswers).length > 0;
    const canUseRagNow = this.ragPolicy.canUse({
      symptom: detectedSymptom,
      contextAnswers: mergedContextAnswers,
    });

    if (!questionSetMatches && hasCollectedContext && followupKey) {
      const followupQuestion =
        this.questionPolicy.getTemplate(questionSet).followups[followupKey];

      if (followupQuestion) {
        return this.buildDirectResponse({
          text: this.safetyPolicy.prepend(followupQuestion, safetyWarning),
          state: {
            ...baseState,
            contextQuestionsAsked: true,
            phase: 'ASKING_CONTEXT',
            askedFollowupKey: followupKey,
          },
        });
      }
    }

    if (!questionSetMatches && hasCollectedContext && canUseRagNow) {
      return {
        action: 'USE_RAG',
        nextState: {
          ...baseState,
          contextQuestionsAsked: true,
          phase: 'READY_FOR_RAG',
        },
        ragQuery: this.ragPolicy.buildQuery({
          device: detectedDevice,
          symptom: detectedSymptom,
          contextAnswers: mergedContextAnswers,
        }),
        safetyWarning,
      };
    }

    if (!questionSetMatches) {
      return this.buildDirectResponse({
        text: this.questionPolicy.buildQuestionSetMessage(questionSet),
        state: {
          ...baseState,
          contextQuestionsAsked: true,
          askedFollowupKey: null,
          phase: 'ASKING_CONTEXT',
        },
      });
    }

    if (followupKey && previousState.askedFollowupKey === followupKey) {
      const repeatedFollowupQuestion =
        this.questionPolicy.getTemplate(questionSet).followups[followupKey];

      if (repeatedFollowupQuestion) {
        return this.buildDirectResponse({
          text: this.safetyPolicy.prepend(
            this.questionPolicy.buildRetryFollowupPrompt(
              repeatedFollowupQuestion,
            ),
            safetyWarning,
          ),
          state: {
            ...baseState,
            phase: 'ASKING_CONTEXT',
            askedFollowupKey: followupKey,
          },
        });
      }
    }

    if (followupKey) {
      const followupQuestion =
        this.questionPolicy.getTemplate(questionSet).followups[followupKey];

      if (followupQuestion) {
        const prompt =
          previousState.askedFollowupKey === followupKey
            ? `Mình vẫn cần bạn xác nhận giúp mình một ý này: ${followupQuestion}`
            : followupQuestion;

        return this.buildDirectResponse({
          text: this.safetyPolicy.prepend(prompt, safetyWarning),
          state: {
            ...baseState,
            phase: 'ASKING_CONTEXT',
            askedFollowupKey: followupKey,
          },
        });
      }
    }

    if (canUseRagNow) {
      return {
        action: 'USE_RAG',
        nextState: {
          ...baseState,
          contextQuestionsAsked: true,
          phase: 'READY_FOR_RAG',
        },
        ragQuery: this.ragPolicy.buildQuery({
          device: detectedDevice,
          symptom: detectedSymptom,
          contextAnswers: mergedContextAnswers,
        }),
        safetyWarning,
      };
    }

    return this.buildDirectResponse({
      text: this.safetyPolicy.prepend(
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
    // Đóng gói câu trả lời trực tiếp cùng state mới mà không cần gọi RAG hoặc Gemini tư vấn.
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
    // Tiếp tục flow hỏi đáp từng bước đã tồn tại cho các session đang ở chế độ GUIDED_DIAGNOSIS.
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
    // Chọn câu hỏi tiếp theo của flow legacy dựa trên thiết bị và số thứ tự bước hiện tại.
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
    // Phân loại thiết bị vào nhóm nghiệp vụ để chọn đúng bộ câu hỏi context chuyên biệt.
    const device = this.cleanText(input.device).toLowerCase();

    if (device.includes('điều hòa') || device.includes('máy lạnh')) {
      return 'COOLING_HEATING';
    }
    if (
      device.includes('tủ lạnh') ||
      device.includes('tủ đông') ||
      device.includes('máy nước nóng') ||
      device.includes('bình nóng lạnh') ||
      device.includes('máy sấy') ||
      device.includes('máy sưởi') ||
      device.includes('quạt sưởi') ||
      device.includes('đèn sưởi')
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
    // Chuyển category không xác định về nhóm generic an toàn.
    return value === 'UNKNOWN' ? 'GENERIC_APPLIANCE' : value;
  }

  private normalizeCanonicalSymptom(value?: string | null) {
    // Chuẩn hóa các cách nói tương đương về symptom canonical để chọn đúng question set và RAG.
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

    if (/khong suoi|khong am|chi pha gio|pha gio nhe/.test(normalized)) {
      return 'Không sưởi được';
    }

    return symptom;
  }

  private isContradictoryDeviceSymptom(
    device: string,
    symptom: string | null,
  ) {
    // Phát hiện cặp thiết bị/triệu chứng bất thường để yêu cầu xác nhận thay vì khóa sai session.
    const lowerDevice = device.toLowerCase();
    const lowerSymptom = this.cleanText(symptom).toLowerCase();

    return (
      lowerDevice.includes('máy giặt') &&
      (lowerSymptom.includes('không lạnh') || lowerSymptom.includes('bị lạnh'))
    );
  }

  private cleanText(value: unknown) {
    // Chuẩn hóa một giá trị không xác định về chuỗi đã trim hoặc null.
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeText(value: string) {
    // Chuyển tiếng Việt về dạng không dấu, chữ thường để các rule so khớp ổn định.
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeDeviceKey(value: string | null) {
    // Gom các alias cùng nghĩa về một khóa thiết bị để tránh false-positive device switch.
    const normalized = this.normalizeText(value ?? '');

    if (!normalized) {
      return '';
    }

    if (normalized === 'may lanh' || normalized === 'dieu hoa') {
      return 'air_conditioner';
    }

    return normalized;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    // Kiểm tra object thuần trước khi đọc context/state động.
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private normalizeFlags(value: unknown) {
    // Lọc và loại trùng các flag string nhận từ state cũ hoặc extractor.
    const flags = Array.isArray(value)
      ? value.filter((flag): flag is string => typeof flag === 'string')
      : [];

    return flags.filter((flag) => !TRANSIENT_BLOCKING_FLAGS.has(flag));
  }
}
