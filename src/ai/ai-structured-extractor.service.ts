import { Injectable, Logger } from '@nestjs/common';

import {
  structuredExtractionResponseSchema,
  structuredExtractorSystemPrompt,
} from './ai.constants';
import { AiGeminiService } from './ai-gemini.service';

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
  private readonly deviceAliases = [
    {
      label: 'Điều hòa',
      promptLabel: 'máy lạnh',
      aliases: ['máy lạnh', 'may lanh', 'điều hòa', 'dieu hoa'],
    },
    {
      label: 'Máy giặt',
      promptLabel: 'máy giặt',
      aliases: ['máy giặt', 'may giat'],
    },
    {
      label: 'Tủ lạnh',
      promptLabel: 'tủ lạnh',
      aliases: ['tủ lạnh', 'tu lanh', 'cái tủ', 'cai tu', 'tủ đông', 'tu dong'],
    },
    {
      label: 'Lò vi sóng',
      promptLabel: 'lò vi sóng',
      aliases: ['lò vi sóng', 'lo vi song'],
    },
    {
      label: 'Máy rửa bát',
      promptLabel: 'máy rửa bát',
      aliases: ['máy rửa bát', 'may rua bat'],
    },
    {
      label: 'Bếp từ',
      promptLabel: 'bếp từ',
      aliases: ['bếp từ', 'bep tu'],
    },
  ];

  constructor(private readonly aiGeminiService: AiGeminiService) {}

  async extract(input: ExtractInput): Promise<StructuredExtractionResult | null> {
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
    const lowerText = originalText.toLowerCase();
    const devices: Array<{ label: string; promptLabel: string; aliases: string[] }> = [];

    for (const device of this.deviceAliases) {
      if (device.aliases.some((alias) => lowerText.includes(alias))) {
        devices.push(device);
      }
    }

    return devices;
  }

  private findPrioritizedDevice(
    originalText: string,
    mentionedDevices: Array<{ label: string; promptLabel: string; aliases: string[] }>,
  ) {
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

  private shouldRun(input: ExtractInput) {
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
    const isLongMessage = input.originalText.trim().length >= 80;
    const hasMultipleClauses =
      /[,;:]|\bnhung\b|\bma\b|\bvan\b|\broi\b|\bxong\b|\bhinh nhu\b/u.test(text);
    const hasProblemSignal =
      /\bkhong\b|\bhu\b|\bloi\b|\bvan de\b|\bmat\b|\blanh\b|\bnong\b|\bnuoc\b|\bgio\b|\bden\b|\bquay\b|\bkhong thoat\b|\bhut yeu\b/u.test(
        text,
      );

    return (
      hasMultipleDeviceSignals ||
      (hasProblemSignal &&
        (isLongMessage || hasMultipleClauses || !hasRuleDevice || !hasRuleSymptom))
    );
  }

  private hasMultipleDeviceSignals(originalText: string) {
    return this.collectMentionedDevices(originalText).length >= 2;
  }

  private buildPrompt(input: ExtractInput) {
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
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeText(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
