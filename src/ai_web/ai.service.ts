import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JobStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import { RAG_LIMITS } from '../rag/rag.constants';
import { AiConversationPersistenceService } from './ai-conversation-persistence.service';
import { SAFE_FALLBACK_STATE, TECHNICAL_NO_RAG_FALLBACK } from './ai.constants';
import { AiGeminiService } from './ai-gemini.service';
import { AiGuidedDiagnosisService } from './ai-guided-diagnosis.service';
import { AiIntentGateService } from './ai-intent-gate.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiRelatedHistoryService } from './ai-related-history.service';
import { AiResponseBuilderService } from './ai-response-builder.service';
import {
  AiStructuredExtractorService,
  StructuredExtractionResult,
} from './ai-structured-extractor.service';

type PlainState = Record<string, any>;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragRetrievalService: RagRetrievalService,
    private readonly aiIntentGateService: AiIntentGateService,
    private readonly aiGuidedDiagnosisService: AiGuidedDiagnosisService,
    private readonly aiResponseBuilderService: AiResponseBuilderService,
    private readonly aiConversationPersistenceService: AiConversationPersistenceService,
    private readonly aiRelatedHistoryService: AiRelatedHistoryService,
    private readonly aiRateLimitService: AiRateLimitService,
    private readonly aiGeminiService: AiGeminiService,
    private readonly aiStructuredExtractorService: AiStructuredExtractorService,
  ) {}

  async chatWithAI(
    userId: number,
    message: string,
    sessionIdParam: number | null,
    imageBase64?: string,
    history: any[] = [],
  ) {
    if (!message || !message.trim()) {
      throw new BadRequestException('Vui lòng nhập nội dung cần tư vấn.');
    }

    if (message.length > 1000) {
      throw new HttpException(
        'Tin nhắn quá dài, bạn tóm tắt lại giúp mình khoảng 3-4 câu nhé.',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.aiRateLimitService.assertRateLimit(userId);

    const sessionId = sessionIdParam ?? null;
    const prevState = await this.aiConversationPersistenceService.getPreviousState(
      userId,
      sessionId,
    );
    const sessionContext = await this.getSessionContext(sessionId);

    if (sessionContext && sessionContext.status !== JobStatus.AI_CONSULTING) {
      throw new BadRequestException(
        'Phiên chẩn đoán AI này đã đóng, không thể chat thêm.',
      );
    }

    let intentGate = this.aiIntentGateService.analyze(message);
    let effectivePrevState = this.seedPrevStateFromSessionContext(
      this.ensurePlainState(prevState),
      sessionContext,
    );

    const extractorMerged = await this.enrichFromStructuredExtractor({
      originalText: message,
      prevState: effectivePrevState,
      intentGate,
    });
    intentGate = extractorMerged.intentGate;
    effectivePrevState = extractorMerged.prevState;

    if (intentGate.shouldReturnDirectResponse) {
      const directParsed =
        this.aiResponseBuilderService.buildDirectParsedResponse(
          intentGate,
          effectivePrevState,
        );

      return this.aiConversationPersistenceService.finalizeDirectResponse({
        userId,
        sessionId,
        message,
        prevState: effectivePrevState,
        parsed: this.decorateWebParsedResponse(
          directParsed,
          effectivePrevState,
          sessionContext,
        ),
      });
    }

    const nextStep = this.aiGuidedDiagnosisService.resolveNextStep({
      originalText: message,
      prevState: effectivePrevState,
      intentGate,
    });

    if (nextStep.action === 'DIRECT_RESPONSE') {
      return this.aiConversationPersistenceService.finalizeDirectResponse({
        userId,
        sessionId,
        message,
        prevState: effectivePrevState,
        parsed: this.decorateWebParsedResponse(
          nextStep.parsedResponse,
          effectivePrevState,
          sessionContext,
        ),
      });
    }

    const ragResults = await this.retrieveRelevantChunks({
      userId,
      message,
      ragQuery: nextStep.ragQuery,
      intentGate,
      prevState: effectivePrevState,
      sessionContext,
    });

    if (ragResults.length === 0) {
      return this.aiConversationPersistenceService.finalizeDirectResponse({
        userId,
        sessionId,
        message,
        prevState: effectivePrevState,
        parsed: this.decorateWebParsedResponse(
          this.aiResponseBuilderService.buildNoRagFallback(
            intentGate,
            effectivePrevState,
            message,
          ),
          effectivePrevState,
          sessionContext,
        ),
      });
    }

    const cleanMessage =
      this.aiResponseBuilderService.sanitizeUserMessage(message);
    const cleanHistory =
      this.aiResponseBuilderService.buildCleanGeminiHistory(history);

    const userPrompt = this.aiResponseBuilderService.buildUserPrompt({
      ragContext: this.aiResponseBuilderService.buildRagContext(ragResults),
      rlhfInstruction: '',
      deviceContext: await this.buildDeviceContext(userId),
      lastStateContext: this.buildLastStateContext(effectivePrevState),
      intentGate,
      cleanMessage,
    });

    let rawParsed: any;

    try {
      const raw = await this.aiGeminiService.generateRawResponse({
        userPrompt,
        history: cleanHistory,
        imageBase64,
      });

      rawParsed = JSON.parse(raw);
    } catch (error) {
      this.logger.warn(
        `JSON.parse hoặc Gemini lỗi ở ai_web, fallback về câu trả lời an toàn. ${String(
          error,
        )}`,
      );
      rawParsed = {
        text: TECHNICAL_NO_RAG_FALLBACK,
        state: effectivePrevState || SAFE_FALLBACK_STATE,
        is_booking_triggered: false,
      };
    }

    const normalizedParsed =
      this.aiResponseBuilderService.normalizeParsedResponse(
        rawParsed,
        effectivePrevState,
      );

    const finalParsed = this.decorateWebParsedResponse(
      normalizedParsed,
      effectivePrevState,
      sessionContext,
    );

    const finalized = await this.aiConversationPersistenceService.finalizeAiResponse(
      {
        userId,
        sessionId,
        message,
        prevState: effectivePrevState,
        parsed: finalParsed,
      },
    );

    const relatedHistory = await this.resolveRelatedHistory(userId, finalized);

    return relatedHistory
      ? {
          ...finalized,
          relatedHistory,
        }
      : finalized;
  }

  async saveFeedback(logId: number, feedback: 'LIKE' | 'DISLIKE') {
    return this.aiConversationPersistenceService.saveFeedback(logId, feedback);
  }

  async getGoldenExamples(category: string, limit = 2) {
    return this.aiConversationPersistenceService.getGoldenExamples(
      category,
      limit,
    );
  }

  private async getSessionContext(sessionId: number | null) {
    if (!sessionId) {
      return null;
    }

    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
      },
    });
  }

  private async buildDeviceContext(userId: number) {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: {
        category: true,
        brandName: true,
        modelCode: true,
      },
    });

    if (devices.length === 0) {
      return '';
    }

    return `\n[THÔNG TIN THIẾT BỊ KHÁCH HÀNG]: ${devices
      .map((device) => {
        const brand = device.brandName?.trim() || 'Không rõ hãng';
        const category = device.category?.trim() || 'Thiết bị';
        const model = device.modelCode?.trim()
          ? ` (${device.modelCode.trim()})`
          : '';
        return `${brand} ${category}${model}`;
      })
      .join(', ')}`;
  }

  private buildLastStateContext(prevState: PlainState | null) {
    if (!prevState) {
      return '\n[TRẠNG THÁI HIỆN TẠI]: Phiên chat mới, chưa có trạng thái trước đó.';
    }

    return `\n[TRẠNG THÁI HIỆN TẠI]: ${JSON.stringify(prevState)}`;
  }

  private async enrichFromStructuredExtractor(input: {
    originalText: string;
    prevState: PlainState | null;
    intentGate: any;
  }) {
    const prevState = this.ensurePlainState(input.prevState) || {};
    const intentGate = { ...input.intentGate };
    const previousDeviceKey = this.normalizeDeviceKey(prevState.device);
    const detectedDeviceKey = this.normalizeDeviceKey(
      intentGate.detectedDeviceLabel,
    );

    if (
      previousDeviceKey &&
      detectedDeviceKey &&
      previousDeviceKey !== detectedDeviceKey
    ) {
      return { prevState, intentGate };
    }

    if (
      this.shouldSkipStructuredExtractor(
        input.originalText,
        prevState,
        intentGate,
      )
    ) {
      return { prevState, intentGate };
    }

    const extracted = await this.aiStructuredExtractorService.extract({
      originalText: input.originalText,
      prevState,
      intentGate,
    });

    if (!extracted) {
      return { prevState, intentGate };
    }

    const normalizedExtraction =
      this.normalizeStructuredExtractionForWebScope(extracted);
    const nextState: PlainState = { ...prevState };
    const nextIntentGate = { ...intentGate };
    const overallConfidence = normalizedExtraction.confidence?.overall ?? 0;

    if (normalizedExtraction.detectedOtherDevices?.length) {
      nextState.detectedOtherDevices = normalizedExtraction.detectedOtherDevices;
    }

    if (Array.isArray(normalizedExtraction.flags) && normalizedExtraction.flags.length > 0) {
      nextState.flags = Array.from(
        new Set([...(Array.isArray(prevState.flags) ? prevState.flags : []), ...normalizedExtraction.flags]),
      );
    }

    if (normalizedExtraction.needsClarification) {
      nextState.clarificationQuestion =
        normalizedExtraction.clarificationQuestion ||
        nextState.clarificationQuestion ||
        null;
      nextIntentGate.detectedDeviceLabel = null;
      nextIntentGate.detectedIssueLabel = null;
      return { prevState: nextState, intentGate: nextIntentGate };
    }

    if (overallConfidence < 0.65) {
      return { prevState: nextState, intentGate: nextIntentGate };
    }

    if (
      normalizedExtraction.device &&
      (!prevState.device ||
        this.normalizeDeviceKey(prevState.device) ===
          this.normalizeDeviceKey(normalizedExtraction.device))
    ) {
      nextIntentGate.detectedDeviceLabel =
        prevState.device || normalizedExtraction.device;
    }

    if (normalizedExtraction.symptom) {
      nextIntentGate.detectedIssueLabel = normalizedExtraction.symptom;
    }

    if (normalizedExtraction.deviceCategory) {
      nextIntentGate.supportedDeviceCategory = normalizedExtraction.deviceCategory;
    }

    this.syncIntentGateFromExtraction(nextIntentGate);

    if (normalizedExtraction.risk) {
      nextState.risk = normalizedExtraction.risk;
    }

    if (
      normalizedExtraction.contextAnswers &&
      typeof normalizedExtraction.contextAnswers === 'object' &&
      !Array.isArray(normalizedExtraction.contextAnswers)
    ) {
      nextState.contextAnswers = {
        ...(this.ensurePlainState(prevState.contextAnswers) || {}),
        ...Object.fromEntries(
          Object.entries(normalizedExtraction.contextAnswers).filter(
            ([, value]) => typeof value === 'string' && value.trim(),
          ),
        ),
      };
    }

    return { prevState: nextState, intentGate: nextIntentGate };
  }

  private shouldSkipStructuredExtractor(
    originalText: string,
    prevState: PlainState,
    intentGate: any,
  ) {
    if (this.countSupportedDeviceMentions(originalText) > 1) {
      return false;
    }

    const hasClearTechnicalIntent =
      typeof intentGate?.detectedDeviceLabel === 'string' &&
      intentGate.detectedDeviceLabel.trim().length > 0 &&
      typeof intentGate?.detectedIssueLabel === 'string' &&
      intentGate.detectedIssueLabel.trim().length > 0;

    if (hasClearTechnicalIntent) {
      return true;
    }

    const previousDeviceKey = this.normalizeDeviceKey(prevState?.device);
    const detectedDeviceKey = this.normalizeDeviceKey(
      intentGate?.detectedDeviceLabel,
    );

    return Boolean(
      previousDeviceKey &&
        detectedDeviceKey &&
        previousDeviceKey !== detectedDeviceKey,
    );
  }

  private countSupportedDeviceMentions(originalText: string) {
    const normalized = this.normalizeText(originalText);
    const deviceGroups = [
      ['may lanh', 'dieu hoa'],
      ['may giat'],
      ['tu lanh', 'cai tu', 'tu dong'],
      ['lo vi song', 'microwave'],
      ['may rua bat', 'may rua chen'],
      ['bep tu'],
      ['may suoi', 'quat suoi', 'den suoi'],
    ];

    return deviceGroups.filter((keywords) =>
      keywords.some((keyword) => normalized.includes(keyword)),
    ).length;
  }

  private syncIntentGateFromExtraction(intentGate: any) {
    const hasDevice =
      typeof intentGate?.detectedDeviceLabel === 'string' &&
      intentGate.detectedDeviceLabel.trim().length > 0;
    const hasIssue =
      typeof intentGate?.detectedIssueLabel === 'string' &&
      intentGate.detectedIssueLabel.trim().length > 0;

    if (hasDevice && hasIssue) {
      intentGate.intent = 'TECHNICAL_SPECIFIC';
      intentGate.isTechnical = true;
      intentGate.isTechnicalSpecific = true;
      intentGate.isTechnicalVague = false;
      intentGate.shouldUseRag = false;
      intentGate.shouldAskClarification = false;
      intentGate.shouldReturnDirectResponse = false;
      return;
    }

    if (hasDevice || hasIssue) {
      intentGate.intent = 'TECHNICAL_VAGUE';
      intentGate.isTechnical = true;
      intentGate.isTechnicalSpecific = false;
      intentGate.isTechnicalVague = true;
      intentGate.shouldUseRag = false;
      intentGate.shouldAskClarification = true;
      intentGate.shouldReturnDirectResponse = false;
    }
  }

  private async retrieveRelevantChunks(input: {
    userId: number;
    message: string;
    ragQuery: string;
    intentGate: any;
    prevState: PlainState | null;
    sessionContext: {
      deviceType?: string | null;
      symptom?: string | null;
    } | null;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { role: true },
    });
    const accessLevel =
      user?.role === 'TECHNICIAN' || user?.role === 'ADMIN'
        ? 'ADVANCED'
        : 'BASIC';

    let results: any[] = [];
    const categoryFilter =
      input.intentGate.supportedDeviceCategory &&
      input.intentGate.supportedDeviceCategory !== 'UNKNOWN'
        ? input.intentGate.supportedDeviceCategory
        : input.prevState?.deviceCategory || null;

    try {
      const ragRes = await this.ragRetrievalService.findRelevantChunks({
        query: input.ragQuery || input.message,
        accessLevel,
        limit: RAG_LIMITS.DEFAULT_RETRIEVAL_LIMIT,
        minScore: RAG_LIMITS.MIN_RETRIEVAL_SCORE,
        category: categoryFilter,
        brand: input.intentGate.detectedBrand || input.prevState?.brand || null,
        modelCode: input.prevState?.model || null,
      });

      results = ragRes.results as any[];

      if (results.length === 0) {
        const fallbackRes = await this.ragRetrievalService.findRelevantChunks({
          query: input.ragQuery || input.message,
          accessLevel,
          limit: RAG_LIMITS.DEFAULT_RETRIEVAL_LIMIT,
          minScore: 0,
        });
        results = fallbackRes.results as any[];
      }

      this.aiResponseBuilderService.prioritizeChunksByErrorCode(
        input.message,
        results,
      );
    } catch (error) {
      this.logger.error('Lỗi gọi RAG cho ai_web', error);
    }

    return results;
  }

  private decorateWebParsedResponse(
    parsed: any,
    prevState: PlainState | null,
    sessionContext: {
      status?: JobStatus;
      deviceType?: string | null;
      symptom?: string | null;
      aiSummary?: string | null;
    } | null,
  ) {
    const state = this.ensurePlainState(parsed?.state) || {};
    const risk = this.normalizeRisk(state.risk || prevState?.risk || 'UNKNOWN');
    const symptomDetail =
      this.cleanText(state.symptom) ||
      this.cleanText(prevState?.symptom) ||
      this.cleanText(sessionContext?.symptom) ||
      null;
    const symptomLabel = this.toSymptomLabel(symptomDetail);
    const device =
      this.cleanText(state.device) ||
      this.cleanText(prevState?.device) ||
      this.cleanText(sessionContext?.deviceType) ||
      null;
    const finalAiSummary = this.buildFinalAiSummary({
      device,
      symptomDetail,
      symptomLabel,
      risk,
      aiText: this.cleanText(parsed?.text) || sessionContext?.aiSummary || '',
    });
    const canBook = this.canOpenBooking({
      parsed,
      state,
      prevState,
    });

    const nextState: PlainState = {
      ...prevState,
      ...state,
      device,
      risk,
      symptom: symptomDetail,
      symptomLabel,
      symptomDetail,
      canBook,
      chatClosed:
        sessionContext?.status != null &&
        sessionContext.status !== JobStatus.AI_CONSULTING,
      finalAiSummary,
      aiSummaryText: finalAiSummary.analysis,
    };

    return {
      ...parsed,
      text: this.cleanText(parsed?.text) || TECHNICAL_NO_RAG_FALLBACK,
      state: nextState,
      is_booking_triggered: false,
      canBook,
      chatClosed: nextState.chatClosed,
      symptomLabel,
      symptomDetail,
      finalAiSummary,
    };
  }

  private buildFinalAiSummary(input: {
    device: string | null;
    symptomDetail: string | null;
    symptomLabel: string | null;
    risk: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    aiText: string;
  }) {
    const headlineParts = [input.device, input.symptomLabel].filter(Boolean);
    const headline =
      headlineParts.length > 0
        ? headlineParts.join(' - ')
        : 'Tóm tắt tư vấn AI';

    return {
      headline,
      device: input.device,
      symptomLabel: input.symptomLabel,
      symptomDetail: input.symptomDetail,
      risk: input.risk,
      analysis: input.aiText,
      whyBookingNeeded:
        input.risk === 'RED'
          ? 'Thiết bị có dấu hiệu rủi ro cao, cần kỹ thuật viên kiểm tra trực tiếp.'
          : null,
    };
  }

  private async resolveRelatedHistory(userId: number, finalized: any) {
    const device = this.cleanText(finalized?.state?.device);
    const brand = this.cleanText(finalized?.state?.brand);

    if (!device) {
      return null;
    }

    try {
      const deviceId = await this.aiRelatedHistoryService.resolveDeviceId(
        userId,
        device,
        brand,
      );

      return this.aiRelatedHistoryService.findRelatedCase({
        userId,
        currentSessionId: finalized?.sessionId ?? null,
        deviceId,
        deviceType: device,
        brandHint: brand,
      });
    } catch (error) {
      this.logger.warn(`Không thể tìm related history cho ai_web: ${String(error)}`);
      return null;
    }
  }

  private ensurePlainState(value: unknown): PlainState | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as PlainState)
      : null;
  }

  private normalizeStructuredExtractionForWebScope(
    extracted: StructuredExtractionResult,
  ): StructuredExtractionResult {
    const normalized: StructuredExtractionResult = { ...extracted };
    const canonicalDevice = this.resolveSupportedWebDeviceLabel(extracted.device);

    normalized.device = canonicalDevice;
    if (!canonicalDevice) {
      normalized.deviceCategory = null;
    }

    if (Array.isArray(extracted.detectedOtherDevices)) {
      normalized.detectedOtherDevices = Array.from(
        new Set(
          extracted.detectedOtherDevices
            .map((value) => this.resolveSupportedWebDeviceLabel(value))
            .filter(
              (value): value is string =>
                Boolean(value) && value !== canonicalDevice,
            ),
        ),
      );
    }

    return normalized;
  }

  private seedPrevStateFromSessionContext(
    prevStateValue: PlainState | null,
    sessionContext: {
      deviceType?: string | null;
      symptom?: string | null;
      aiSummary?: string | null;
    } | null,
  ): PlainState {
    const prevState = prevStateValue ? { ...prevStateValue } : {};

    if (!this.cleanText(prevState.device) && this.cleanText(sessionContext?.deviceType)) {
      prevState.device = sessionContext?.deviceType?.trim();
    }

    if (!this.cleanText(prevState.symptom) && this.cleanText(sessionContext?.symptom)) {
      prevState.symptom = sessionContext?.symptom?.trim();
    }

    if (
      !this.cleanText(prevState.aiSummaryText) &&
      this.cleanText(sessionContext?.aiSummary)
    ) {
      prevState.aiSummaryText = sessionContext?.aiSummary?.trim();
    }

    return prevState;
  }

  private cleanText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private resolveSupportedWebDeviceLabel(value: unknown) {
    const cleaned = this.cleanText(value);
    if (!cleaned) {
      return null;
    }

    const normalized = this.normalizeText(cleaned);
    const supportedAliases = [
      ['may lanh', 'dieu hoa'],
      ['may giat'],
      ['tu lanh', 'cai tu', 'tu dong'],
      ['lo vi song', 'microwave'],
      ['may rua bat', 'may rua chen'],
      ['bep tu'],
      ['may suoi', 'quat suoi', 'den suoi'],
    ];

    return supportedAliases.some((aliases) =>
      aliases.some((alias) => normalized === alias || normalized.includes(alias)),
    )
      ? cleaned
      : null;
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

  private normalizeDeviceKey(value: unknown) {
    const normalized = this.normalizeText(
      typeof value === 'string' ? value : '',
    );

    if (!normalized) {
      return '';
    }

    if (normalized === 'may lanh' || normalized === 'dieu hoa') {
      return 'air_conditioner';
    }

    return normalized;
  }

  private normalizeRisk(value: unknown): 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' {
    if (value === 'GREEN' || value === 'YELLOW' || value === 'RED') {
      return value;
    }

    return 'UNKNOWN';
  }

  private canOpenBooking(input: {
    parsed: any;
    state: PlainState;
    prevState: PlainState | null;
  }) {
    if (input.parsed?.is_booking_triggered === true) {
      return true;
    }

    if (input.state?.canBook === true || input.prevState?.canBook === true) {
      return true;
    }

    if (input.state?.phase === 'READY_TO_BOOK') {
      return true;
    }

    if (input.state?.diagnosisFlow?.nextAction === 'SUGGEST_BOOKING') {
      return true;
    }

    return false;
  }

  private toSymptomLabel(value: string | null) {
    if (!value) {
      return null;
    }

    const normalized = this.normalizeText(value);

    if (
      /khong lam mat|khong mat|khong lanh|phong ham ham|chang thay mat/.test(
        normalized,
      )
    ) {
      return 'Không lạnh';
    }

    if (
      /khong lam nong|khong nong|do an van nguoi|quay xong van nguoi/.test(
        normalized,
      )
    ) {
      return 'Không nóng';
    }

    if (/mui khet|boc khoi|co khoi|dang chay|bi chay|chay khet/.test(normalized)) {
      return 'Có dấu hiệu cháy';
    }

    if (/ro dien|giat dien|chap dien|tia lua/.test(normalized)) {
      return 'Rủi ro điện';
    }

    if (/ro nuoc|chay nuoc|ri nuoc/.test(normalized)) {
      return 'Rò nước';
    }

    if (/khong vat|do con sung nuoc|quan ao con uot|do con uot/.test(normalized)) {
      return 'Không vắt';
    }

    if (/khong len nguon|mat nguon|khong vao dien/.test(normalized)) {
      return 'Không lên nguồn';
    }

    return value.length > 48 ? `${value.slice(0, 45).trimEnd()}...` : value;
  }
}
