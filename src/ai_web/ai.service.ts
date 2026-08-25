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
import { SAFE_FALLBACK_STATE, TECHNICAL_NO_RAG_FALLBACK } from './ai.constants';
import { AiIntentGateService } from './extraction/ai-intent-gate.service';
import {
  AiStructuredExtractorService,
  StructuredExtractionResult,
} from './extraction/ai-structured-extractor.service';
import { AiGeminiService } from './generation/ai-gemini.service';
import { AiResponseBuilderService } from './generation/ai-response-builder.service';
import { AiGuidedDiagnosisService } from './orchestration/ai-guided-diagnosis.service';
import { AiSessionContextService } from './orchestration/ai-session-context.service';
import { AiConversationPersistenceService } from './persistence/ai-conversation-persistence.service';
import { AiRelatedHistoryService } from './persistence/ai-related-history.service';
import { AiRateLimitService } from './policies/ai-rate-limit.service';
import { AiWebDeviceCatalogService } from './policies/ai-web-device-catalog.service';

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
    private readonly deviceCatalog: AiWebDeviceCatalogService =
      new AiWebDeviceCatalogService(),
    private readonly sessionContextService: AiSessionContextService =
      new AiSessionContextService(prisma),
  ) {
    // Nhận các service chuyên trách để điều phối toàn bộ pipeline AI dành riêng cho website.
  }

  async chatWithAI(
    userId: number,
    message: string,
    sessionIdParam: number | null,
    imageBase64?: string,
    history: any[] = [],
  ) {
    // Điều phối một lượt chat: validate, rule, extractor, diagnosis, RAG/LLM và persistence.
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
    const sessionContext = await this.sessionContextService.getSessionContext(sessionId);

    if (sessionContext && sessionContext.status !== JobStatus.AI_CONSULTING) {
      throw new BadRequestException(
        'Phiên chẩn đoán AI này đã đóng, không thể chat thêm.',
      );
    }

    let intentGate = this.aiIntentGateService.analyze(message);
    let effectivePrevState = this.sessionContextService.seedPreviousState(
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
      deviceContext: await this.sessionContextService.buildDeviceContext(userId),
      lastStateContext:
        this.sessionContextService.buildLastStateContext(effectivePrevState),
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
    // Chuyển feedback người dùng sang persistence service để cập nhật reasoning log idempotent.
    return this.aiConversationPersistenceService.saveFeedback(logId, feedback);
  }

  async rateAiSession(
    userId: number,
    sessionId: number,
    rating: number,
    comment?: string,
  ) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });

    if (!session || session.userId !== userId) {
      throw new HttpException(
        'Không tìm thấy phiên tư vấn hoặc bạn không có quyền đánh giá.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        aiRating: rating,
        aiRatingComment: comment?.trim() || null,
        aiRatedAt: new Date(),
      },
    });

    this.logger.log(
      `User #${userId} đã đánh giá phiên AI web #${sessionId}: ${rating} sao`,
    );

    return { success: true, rating };
  }

  async getGoldenExamples(category: string, limit = 2) {
    // Lấy các reasoning log chất lượng cao theo nhóm thiết bị để tham chiếu khi cần.
    return this.aiConversationPersistenceService.getGoldenExamples(
      category,
      limit,
    );
  }

  private async enrichFromStructuredExtractor(input: {
    originalText: string;
    prevState: PlainState | null;
    intentGate: any;
  }) {
    // Dùng structured extractor làm fallback, kiểm tra confidence rồi merge kết quả vào rule state.
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
    // Bỏ qua extractor khi rule đã đủ chắc chắn hoặc đang có dấu hiệu chuyển thiết bị.
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
    // Đếm số nhóm thiết bị thuộc alias web xuất hiện trong cùng một câu.
    return this.deviceCatalog.countMentions(originalText);
  }

  private syncIntentGateFromExtraction(intentGate: any) {
    // Đồng bộ lại cờ intent sau khi extractor bổ sung được device hoặc symptom.
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
    // Truy vấn chunk RAG theo query, quyền truy cập và metadata thiết bị, có fallback ngưỡng thấp.
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
    // Chuẩn hóa payload cuối cho FE, gồm state, symptom label, booking flag và AI summary.
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
    // Tạo bản tóm tắt có cấu trúc từ device, symptom, risk và nội dung tư vấn cuối.
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
    // Tìm một ca cũ liên quan sau khi lượt chat đã được lưu, nhưng không làm hỏng flow chính nếu lỗi.
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
    // Chỉ nhận object thuần làm state để tránh truy cập thuộc tính trên null, mảng hoặc primitive.
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as PlainState)
      : null;
  }

  private normalizeStructuredExtractionForWebScope(
    extracted: StructuredExtractionResult,
  ): StructuredExtractionResult {
    // Khóa device từ LLM theo allowlist web và loại các thiết bị ngoài phạm vi khỏi extraction.
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

  private cleanText(value: unknown) {
    // Lấy chuỗi có nội dung đã trim hoặc trả null.
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private resolveSupportedWebDeviceLabel(value: unknown) {
    // Chỉ chấp nhận nhãn thiết bị khớp alias nội bộ được chatbot web hỗ trợ.
    const cleaned = this.cleanText(value);
    if (!cleaned) {
      return null;
    }

    return this.deviceCatalog.resolve(cleaned) ? cleaned : null;
  }

  private normalizeText(value: string) {
    // Chuẩn hóa văn bản không dấu, chữ thường để kiểm tra alias và symptom.
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
    // Quy đổi các alias đồng nghĩa về một key để so sánh device switch chính xác.
    const normalized = this.normalizeText(
      typeof value === 'string' ? value : '',
    );

    if (!normalized) {
      return '';
    }

    return this.deviceCatalog.normalizeKey(value) || normalized;
  }

  private normalizeRisk(value: unknown): 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' {
    // Giới hạn risk về enum mà FE và persistence hiểu được.
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
    // Xác định CTA đặt thợ có được mở từ explicit booking hoặc phase chẩn đoán hay chưa.
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
    // Rút gọn mô tả symptom tự nhiên thành nhãn ngắn dùng cho header và summary.
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
