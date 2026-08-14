import { Injectable, Logger } from '@nestjs/common';

import {
  structuredExtractionResponseSchema,
  structuredExtractorSystemPrompt,
} from '../ai.constants';
import { AiGeminiService } from '../generation/ai-gemini.service';
import {
  AiWebDeviceCatalogService,
  WebDeviceDefinition,
} from '../policies/ai-web-device-catalog.service';

export type StructuredExtractionResult = {
  device?: string | null;
  symptom?: string | null;
  deviceCategory?: string | null;
  contextAnswers?: {
    operationStatus?: string | null;
    errorCode?: string | null;
    abnormalSigns?: string | null;
    brandModel?: string | null;
    whenHappens?: string | null;
    maintenanceHistory?: string | null;
    environmentCondition?: string | null;
    safetySigns?: string | null;
    outdoorUnitStatus?: string | null;
  };
  risk?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  flags?: string[];
  detectedOtherDevices?: string[];
  confidence?: {
    device?: number;
    symptom?: number;
    context?: number;
    overall?: number;
  };
  needsClarification?: boolean;
  clarificationQuestion?: string | null;
};

type ExtractInput = {
  originalText: string;
  prevState: Record<string, any> | null;
  intentGate: {
    detectedDeviceLabel?: string | null;
    detectedIssueLabel?: string | null;
    detectedErrorCode?: string | null;
    isEmergency?: boolean;
  };
};

const KNOWN_DEVICE_CATEGORIES = new Set([
  'COOLING_HEATING',
  'WATER_APPLIANCE',
  'COOKING_APPLIANCE',
  'DISPLAY_AUDIO',
  'CLEANING_APPLIANCE',
  'AIR_WATER_TREATMENT',
  'GENERIC_APPLIANCE',
]);

@Injectable()
export class AiStructuredExtractorService {
  private readonly logger = new Logger(AiStructuredExtractorService.name);
  constructor(
    private readonly aiGeminiService: AiGeminiService,
    private readonly deviceCatalog: AiWebDeviceCatalogService =
      new AiWebDeviceCatalogService(),
  ) {
    // Nhận Gemini adapter để thực hiện structured extraction khi rule chưa đủ dữ liệu.
  }

  //chạy AI để trích xuất thông tin có cấu trúc từ đoạn text
  async extract(input: ExtractInput): Promise<StructuredExtractionResult | null> {
    // Chạy heuristic nhiều thiết bị trước, sau đó gọi LLM JSON nếu câu còn thiếu hoặc mơ hồ.
    if (!this.shouldRun(input)) {
      return null;
    }

    const heuristicResult = this.resolveMultipleDeviceHeuristic(input.originalText);
    if (heuristicResult) {
      return heuristicResult;
    }

    try {
      const raw = await this.aiGeminiService.generateStructuredJson({
        systemInstruction: structuredExtractorSystemPrompt,
        responseSchema: structuredExtractionResponseSchema,
        userPrompt: this.buildPrompt(input),
      });

      const parsed = JSON.parse(raw) as StructuredExtractionResult;
      return this.normalizeResult(parsed);
    } catch (error) {
      this.logger.warn('Structured extractor fallback failed, using rule-based flow only.');
      return null;
    }
  }

  private resolveMultipleDeviceHeuristic(
    originalText: string,
  ): StructuredExtractionResult | null {
    // Xử lý deterministic câu có nhiều thiết bị và tìm thiết bị chính nếu người dùng ưu tiên rõ.
    const mentionedDevices = this.collectMentionedDevices(originalText);

    if (mentionedDevices.length < 2) {
      return null;
    }

    const prioritizedDevice = this.findPrioritizedDevice(
      originalText,
      mentionedDevices,
    );

    if (prioritizedDevice) {
      return {
        device: prioritizedDevice.label,
        detectedOtherDevices: mentionedDevices
          .filter((device) => device.label !== prioritizedDevice.label)
          .map((device) => device.label),
        confidence: {
          device: 0.95,
          overall: 0.95,
        },
      };
    }

    const promptLabels = mentionedDevices.map((device) => device.promptLabel);

    return {
      flags: ['MULTIPLE_DEVICES_DETECTED'],
      needsClarification: true,
      clarificationQuestion: `Bạn muốn mình xử lý thiết bị nào trước: ${promptLabels.join(', ')}?`,
      confidence: {
        overall: 0.95,
      },
    };
  }

  private collectMentionedDevices(originalText: string) {
    // Thu thập toàn bộ thiết bị thuộc alias nội bộ xuất hiện trong câu người dùng.
    return this.deviceCatalog.collectMentions(originalText);
  }

  private findPrioritizedDevice(
    originalText: string,
    mentionedDevices: WebDeviceDefinition[],
  ) {
    // Tìm thiết bị chính qua các cụm như “hỏi ... trước” hoặc “ưu tiên ...”.
    const lowerText = originalText.toLowerCase();

    for (const device of mentionedDevices) {
      for (const alias of device.aliases) {
        if (
          lowerText.includes(`muon hoi ${alias} truoc`) ||
          lowerText.includes(`muốn hỏi ${alias} trước`) ||
          lowerText.includes(`hoi ${alias} truoc`) ||
          lowerText.includes(`hỏi ${alias} trước`) ||
          lowerText.includes(`uu tien ${alias}`) ||
          lowerText.includes(`ưu tiên ${alias}`) ||
          lowerText.includes(`${alias} truoc`) ||
          lowerText.includes(`${alias} trước`)
        ) {
          return device;
        }
      }
    }

    return null;
  }


  //kiểm tra xem thiết bị có chạy hay không dựa vào rule base
  private shouldRun(input: ExtractInput) {
    // Quyết định có cần tốn một lượt LLM extraction hay rule hiện tại đã đủ chắc chắn.
    if (input.intentGate.isEmergency) {
      return false;
    }

    const hasMultipleDeviceSignals = this.hasMultipleDeviceSignals(
      input.originalText,
    );
    const hasRuleDevice = Boolean(this.cleanText(input.intentGate.detectedDeviceLabel));
    const hasRuleSymptom = Boolean(
      this.cleanText(
        input.intentGate.detectedIssueLabel || input.intentGate.detectedErrorCode,
      ),
    );

    if (hasRuleDevice && hasRuleSymptom && !hasMultipleDeviceSignals) {
      return false;
    }

    const text = this.normalizeText(input.originalText);
    const isContextCollectionPhase =
      input.prevState?.phase === 'ASKING_CONTEXT' ||
      input.prevState?.contextQuestionsAsked === true;
    const isLongMessage = input.originalText.trim().length >= 80;
    const hasMultipleClauses =
      /[,;:]|\bnhung\b|\bma\b|\bvan\b|\broi\b|\bxong\b|\bhinh nhu\b/u.test(text);
    const hasProblemSignal =
      /\bkhong\b|\bhu\b|\bloi\b|\bvan de\b|\bmat\b|\blanh\b|\bnong\b|\bnuoc\b|\bgio\b|\bden\b|\bquay\b|\bkhong thoat\b|\bhut yeu\b/u.test(
        text,
      );
    const hasFollowupAnswerSignal =
      /\bco\b|\bcon\b|\bvan\b|\blen nguon\b|\bchay\b|\bkeu\b|\bmui\b|\bro\b|\bluc\b|\bkhi\b|\btu\b|\bphan nao\b/u.test(
        text,
      );

    return (
      hasMultipleDeviceSignals ||
      (isContextCollectionPhase &&
        input.originalText.trim().length >= 8 &&
        hasFollowupAnswerSignal) ||
      (hasProblemSignal &&
        (isLongMessage || hasMultipleClauses || !hasRuleDevice || !hasRuleSymptom))
    );
  }

  private hasMultipleDeviceSignals(originalText: string) {
    // Kiểm tra câu có nhắc từ hai thiết bị alias nội bộ trở lên.
    return this.collectMentionedDevices(originalText).length >= 2;
  }

  private buildPrompt(input: ExtractInput) {
    // Tạo prompt giới hạn LLM ở nhiệm vụ trả JSON extraction, không cho quyết định flow.
    return [
      '[Tin nhắn người dùng]',
      input.originalText.trim(),
      '',
      '[Rule-based hints hiện có]',
      JSON.stringify(
        {
          detectedDeviceLabel: input.intentGate.detectedDeviceLabel ?? null,
          detectedIssueLabel:
            input.intentGate.detectedIssueLabel ||
            input.intentGate.detectedErrorCode ||
            null,
          previousDevice: input.prevState?.device ?? null,
          previousSymptom: input.prevState?.symptom ?? null,
        },
        null,
        2,
      ),
      '',
      'Chỉ trả JSON hợp lệ theo schema. Không trả lời tự nhiên.',
    ].join('\n');
  }

  private normalizeResult(
    value: StructuredExtractionResult,
  ): StructuredExtractionResult | null {
    // Kiểm tra và làm sạch JSON từ LLM trước khi cho phép merge vào state.
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized: StructuredExtractionResult = {};
    const device = this.cleanText(value.device);
    const symptom = this.cleanText(value.symptom);
    const clarificationQuestion = this.cleanText(value.clarificationQuestion);

    if (device) {
      normalized.device = device;
    }

    if (symptom) {
      normalized.symptom = symptom;
    }

    if (
      typeof value.deviceCategory === 'string' &&
      KNOWN_DEVICE_CATEGORIES.has(value.deviceCategory)
    ) {
      normalized.deviceCategory = value.deviceCategory;
    }

    const contextAnswers = this.normalizeContextAnswers(value.contextAnswers);
    if (Object.keys(contextAnswers).length > 0) {
      normalized.contextAnswers = contextAnswers;
    }

    if (value.risk === 'GREEN' || value.risk === 'YELLOW' || value.risk === 'RED' || value.risk === 'UNKNOWN') {
      normalized.risk = value.risk;
    }

    if (Array.isArray(value.flags)) {
      const flags = value.flags
        .map((flag) => this.cleanText(flag))
        .filter((flag): flag is string => Boolean(flag));
      if (flags.length > 0) {
        normalized.flags = [...new Set(flags)];
      }
    }

    if (Array.isArray(value.detectedOtherDevices)) {
      const detectedOtherDevices = value.detectedOtherDevices
        .map((item) => this.cleanText(item))
        .filter((item): item is string => Boolean(item) && item !== device);
      if (detectedOtherDevices.length > 0) {
        normalized.detectedOtherDevices = [...new Set(detectedOtherDevices)];
      }
    }

    const confidence = this.normalizeConfidence(value.confidence);
    if (Object.keys(confidence).length > 0) {
      normalized.confidence = confidence;
    }

    if (typeof value.needsClarification === 'boolean') {
      normalized.needsClarification = value.needsClarification;
    }

    if (clarificationQuestion) {
      normalized.clarificationQuestion = clarificationQuestion;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  private normalizeContextAnswers(value?: StructuredExtractionResult['contextAnswers']) {
    // Giữ các context answer dạng chuỗi có nội dung và bỏ key rỗng từ LLM.
    const normalized: NonNullable<StructuredExtractionResult['contextAnswers']> = {};

    for (const [key, item] of Object.entries(value ?? {})) {
      const cleaned = this.cleanText(item);
      if (cleaned) {
        normalized[key as keyof NonNullable<StructuredExtractionResult['contextAnswers']>] =
          cleaned;
      }
    }

    return normalized;
  }

  private normalizeConfidence(value?: StructuredExtractionResult['confidence']) {
    // Chuẩn hóa confidence từng trường về khoảng 0-1.
    const normalized: NonNullable<StructuredExtractionResult['confidence']> = {};

    for (const [key, item] of Object.entries(value ?? {})) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        normalized[key as keyof NonNullable<StructuredExtractionResult['confidence']>] =
          Math.max(0, Math.min(1, item));
      }
    }

    return normalized;
  }

  private cleanText(value?: string | null) {
    // Trả chuỗi đã trim hoặc null để tránh merge dữ liệu rỗng vào state.
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeText(value: string) {
    // Chuẩn hóa chuỗi không dấu để heuristic alias xử lý nhiều cách nhập tiếng Việt.
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
