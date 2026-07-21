/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable prettier/prettier */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AccessLevel, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';
import { RAG_LIMITS } from '../rag/rag.constants';

import { AiIntentGateService } from './ai-intent-gate.service';
import { AiGuidedDiagnosisService } from './ai-guided-diagnosis.service';
import { AiResponseBuilderService } from './ai-response-builder.service';
import { AiConversationPersistenceService } from './ai-conversation-persistence.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiGeminiService } from './ai-gemini.service';
import {
  AiStructuredExtractorService,
  StructuredExtractionResult,
} from './ai-structured-extractor.service';

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
    clientState: Record<string, any> | null = null,
  ) {
    const originalText = this.validateMessage(message);

    this.aiRateLimitService.assertRateLimit(userId);

    const sessionId: number | null = sessionIdParam;
    const persistedState =
      await this.aiConversationPersistenceService.getPreviousState(
        userId,
        sessionId,
      );
    const prevState = this.mergePreviousState(persistedState, clientState);

    try {
      const intentGate = this.aiIntentGateService.analyze(originalText);
      const structuredExtraction = this.shouldAttemptStructuredExtraction({
        originalText,
        prevState,
        intentGate,
      })
        ? await this.aiStructuredExtractorService.extract({
            originalText,
            prevState,
            intentGate,
          })
        : null;
      const extractionMerge = this.mergeStructuredExtraction({
        originalText,
        prevState,
        intentGate,
        extraction: structuredExtraction,
      });

      let effectiveState = extractionMerge.prevState;
      let ragQuery = originalText;
      let safetyWarning: string | null = null;

      if (extractionMerge.intentGate.isTechnical) {
        const guidedDiagnosis =
          this.aiGuidedDiagnosisService.resolveNextStep({
            originalText,
            prevState: extractionMerge.prevState,
            intentGate: extractionMerge.intentGate,
          });

        if (guidedDiagnosis.action === 'DIRECT_RESPONSE') {
          return this.aiConversationPersistenceService.finalizeDirectResponse({
            userId,
            sessionId,
            message: originalText,
            prevState: extractionMerge.prevState,
            parsed: guidedDiagnosis.parsedResponse,
          });
        }

        effectiveState = guidedDiagnosis.nextState;
        ragQuery = guidedDiagnosis.ragQuery;
        safetyWarning = guidedDiagnosis.safetyWarning || null;
      }

      if (
        extractionMerge.intentGate.shouldReturnDirectResponse &&
        extractionMerge.intentGate.directResponse
      ) {
        const parsed =
          this.aiResponseBuilderService.buildDirectParsedResponse(
            extractionMerge.intentGate,
            effectiveState,
          );

        return this.aiConversationPersistenceService.finalizeDirectResponse({
          userId,
          sessionId,
          message: originalText,
          prevState: extractionMerge.prevState,
          parsed,
        });
      }

      const context = await this.buildConversationContext({
        userId,
        sessionId,
        prevState: effectiveState,
      });

      let ragContext = `
[KIẾN THỨC TỪ HỆ THỐNG]:
Không tìm thấy tài liệu nội bộ phù hợp cho câu hỏi này. Không được bịa nguồn hoặc nói rằng đã tham khảo tài liệu nội bộ nếu thực tế không có.
`;

      let retrievedChunks: any[] = [];
      const shouldUseRag =
        extractionMerge.intentGate.shouldUseRag ||
        effectiveState?.phase === 'READY_FOR_RAG';

      if (shouldUseRag) {
        retrievedChunks = await this.retrieveRagChunks({
          query: ragQuery,
          prevState: effectiveState,
          accessLevel: context.accessLevel,
          devices: context.devices,
          sessionContext: context.sessionContext,
        });

        if (retrievedChunks.length === 0) {
          const parsed = this.aiResponseBuilderService.buildNoRagFallback(
            extractionMerge.intentGate,
            effectiveState,
            ragQuery,
          );

          if (safetyWarning) {
            parsed.text = `${safetyWarning}\n\n${parsed.text}`;
          }

          return this.aiConversationPersistenceService.finalizeDirectResponse({
            userId,
            sessionId,
            message: originalText,
            prevState: extractionMerge.prevState,
            parsed,
          });
        }

        ragContext =
          this.aiResponseBuilderService.buildRagContext(retrievedChunks);
      }

      const currentCategory =
        effectiveState?.deviceCategory ||
        effectiveState?.device ||
        context.sessionContext?.device?.category ||
        context.sessionContext?.deviceType ||
        (context.devices.length > 0 ? context.devices[0].category : '');

      const rlhfInstruction = currentCategory
        ? await this.buildRlhfInstruction(String(currentCategory))
        : '';

      const cleanMessage =
        this.aiResponseBuilderService.sanitizeUserMessage(originalText);
      const userPrompt = this.aiResponseBuilderService.buildUserPrompt({
        ragContext,
        rlhfInstruction,
        deviceContext: context.deviceContext,
        lastStateContext: context.lastStateContext,
        intentGate: extractionMerge.intentGate,
        cleanMessage,
      });
      const cleanHistory =
        this.aiResponseBuilderService.buildCleanGeminiHistory(history);
      const rawText = await this.aiGeminiService.generateRawResponse({
        userPrompt,
        history: cleanHistory,
        imageBase64,
      });

      let parsed: any;

      try {
        parsed = JSON.parse(rawText);
      } catch {
        this.logger.warn(
          `JSON.parse thất bại. rawText: ${rawText.substring(0, 200)}`,
        );

        parsed = {
          text: 'Mình chưa hiểu rõ vấn đề. Bạn mô tả thêm thiết bị và tình trạng lỗi giúp mình nhé.',
          state: effectiveState || null,
          is_booking_triggered: false,
        };
      }

      parsed = this.aiResponseBuilderService.normalizeParsedResponse(
        parsed,
        effectiveState,
      );

      if (parsed.state?.phase === 'READY_FOR_RAG') {
        parsed.state.phase = 'ADVISING';
      }

      if (safetyWarning && !parsed.text.includes(safetyWarning)) {
        parsed.text = `${safetyWarning}\n\n${parsed.text}`;
      }

      if (parsed.state?.risk === 'RED') {
        parsed.is_booking_triggered = true;

        const hasBookingHint = [
          '[ĐẶT THỢ]',
          '[Đặt thợ ngay]',
          '[GỌI THỢ]',
          'Đặt thợ ngay',
        ].some((keyword) => parsed.text?.includes(keyword));

        if (!hasBookingHint) {
          parsed.text +=
            '\n\n🚨 **TÌNH HUỐNG KHẨN CẤP:** Bạn có thể nhấn **[Đặt thợ ngay]** để gửi yêu cầu hỗ trợ chính thức sau khi khu vực đã an toàn.';
        }
      }

      return this.aiConversationPersistenceService.finalizeAiResponse({
        userId,
        sessionId,
        message: originalText,
        prevState: effectiveState,
        parsed,
      });
    } catch (error: any) {
      this.logger.error(`AI Error: ${error.message}`, error.stack);

      if (error.message?.includes('429')) {
        return {
          text: 'Hiện tại lượt dùng Gemini đang tạm hết, bạn thử lại sau ít phút nhé.',
          state: prevState || null,
          is_booking_triggered: false,
        };
      }

      if (error instanceof HttpException) {
        throw error;
      }

      return {
        text: 'Hệ thống AI đang bận, bạn thử lại sau ít phút nhé.',
        state: prevState || null,
        is_booking_triggered: false,
      };
    }
  }

  async saveFeedback(logId: number, feedback: 'LIKE' | 'DISLIKE') {
    return this.aiConversationPersistenceService.saveFeedback(logId, feedback);
  }

  async getGoldenExamples(category: string, limit: number = 2) {
    return this.aiConversationPersistenceService.getGoldenExamples(
      category,
      limit,
    );
  }

  private validateMessage(message: string): string {
    const originalText = (message ?? '').trim();

    if (!originalText) {
      throw new HttpException(
        'Bạn vui lòng nhập nội dung cần hỗ trợ.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (originalText.length > 1000) {
      throw new HttpException(
        'Tin nhắn đang hơi dài, bạn vui lòng tóm tắt lại khoảng 3-4 câu giúp mình nhé.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return originalText;
  }

  private mergePreviousState(
    persistedState: Record<string, any> | null,
    clientState: Record<string, any> | null,
  ) {
    if (!persistedState && !clientState) {
      return null;
    }

    const mergedState = {
      ...(persistedState || {}),
      ...(clientState || {}),
    };

    const mergedContextAnswers = this.mergeContextAnswers(
      persistedState?.contextAnswers,
      clientState?.contextAnswers,
    );

    if (Object.keys(mergedContextAnswers).length > 0) {
      mergedState.contextAnswers = mergedContextAnswers;
    }

    return mergedState;
  }

  private mergeContextAnswers(
    previousValue: unknown,
    nextValue: unknown,
  ): Record<string, unknown> {
    const previous =
      previousValue && typeof previousValue === 'object' && !Array.isArray(previousValue)
        ? (previousValue as Record<string, unknown>)
        : {};
    const next =
      nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
        ? (nextValue as Record<string, unknown>)
        : {};

    const merged: Record<string, unknown> = { ...previous };

    for (const [key, value] of Object.entries(next)) {
      if (typeof value === 'string' && value.trim()) {
        merged[key] = value.trim();
      }
    }

    return merged;
  }

  private mergeStructuredExtraction(input: {
    originalText: string;
    prevState: Record<string, any> | null;
    intentGate: Record<string, any>;
    extraction: StructuredExtractionResult | null;
  }) {
    if (!input.extraction) {
      return {
        prevState: input.prevState,
        intentGate: input.intentGate,
      };
    }

    const nextState = {
      ...(input.prevState || {}),
    };
    const nextIntentGate = {
      ...input.intentGate,
    };

    const currentDevice = this.cleanText(input.prevState?.device);
    const extractedDevice = this.cleanText(input.extraction.device);
    const extractedSymptom = this.cleanText(input.extraction.symptom);
    const extractedCategory = this.cleanText(input.extraction.deviceCategory);
    const hasRuleDevice = Boolean(this.cleanText(input.intentGate.detectedDeviceLabel));
    const hasRuleSymptom = Boolean(
      this.cleanText(
        input.intentGate.detectedIssueLabel || input.intentGate.detectedErrorCode,
      ),
    );
    const canUseExtractedDevice =
      Boolean(extractedDevice) &&
      this.hasEnoughConfidence(
        input.extraction.confidence?.device,
        input.extraction.confidence?.overall,
      ) &&
      (!currentDevice || currentDevice === extractedDevice);
    const canUseExtractedSymptom =
      Boolean(extractedSymptom) &&
      this.hasEnoughConfidence(
        input.extraction.confidence?.symptom,
        input.extraction.confidence?.overall,
      );
    const hasMultipleDevicesUnclear =
      input.extraction.needsClarification === true &&
      Array.isArray(input.extraction.flags) &&
      input.extraction.flags.includes('MULTIPLE_DEVICES_DETECTED') &&
      !extractedDevice;

    const mergedContextAnswers = this.mergeContextAnswers(
      nextState.contextAnswers,
      input.extraction.contextAnswers,
    );
    if (Object.keys(mergedContextAnswers).length > 0) {
      nextState.contextAnswers = mergedContextAnswers;
    }

    if (Array.isArray(input.extraction.flags) && input.extraction.flags.length > 0) {
      nextState.flags = [
        ...new Set([...(nextState.flags || []), ...input.extraction.flags]),
      ];
    }

    if (
      Array.isArray(input.extraction.detectedOtherDevices) &&
      input.extraction.detectedOtherDevices.length > 0
    ) {
      nextState.detectedOtherDevices = [
        ...new Set(input.extraction.detectedOtherDevices),
      ];
    }

    if (
      input.extraction.needsClarification &&
      this.cleanText(input.extraction.clarificationQuestion)
    ) {
      nextState.clarificationQuestion = input.extraction.clarificationQuestion?.trim();
    }

    if (hasMultipleDevicesUnclear && !currentDevice) {
      nextIntentGate.detectedDeviceLabel = null;
      nextIntentGate.detectedIssueLabel = null;
      nextIntentGate.supportedDeviceCategory = 'UNKNOWN';
      nextState.device = null;
      nextState.deviceCategory = null;
    }

    if (
      input.extraction.risk &&
      (input.extraction.risk === 'RED' || !this.cleanText(nextState.risk))
    ) {
      nextState.risk = input.extraction.risk;
    }

    if (!hasRuleDevice && canUseExtractedDevice) {
      nextIntentGate.detectedDeviceLabel = extractedDevice;
    }

    if (!hasRuleSymptom && canUseExtractedSymptom) {
      nextIntentGate.detectedIssueLabel = extractedSymptom;
    }

    if (
      !this.cleanText(nextIntentGate.supportedDeviceCategory) ||
      nextIntentGate.supportedDeviceCategory === 'UNKNOWN'
    ) {
      if (extractedCategory) {
        nextIntentGate.supportedDeviceCategory = extractedCategory;
      }
    }

    const hasTechnicalSignals =
      Boolean(this.cleanText(nextIntentGate.detectedDeviceLabel)) ||
      Boolean(
        this.cleanText(
          nextIntentGate.detectedIssueLabel || nextIntentGate.detectedErrorCode,
        ),
      ) ||
      Object.keys(mergedContextAnswers).length > 0 ||
      input.extraction.risk === 'RED' ||
      input.extraction.needsClarification === true ||
      Boolean(this.cleanText(input.extraction.clarificationQuestion)) ||
      (Array.isArray(input.extraction.flags) && input.extraction.flags.length > 0);

    if (hasTechnicalSignals) {
      nextIntentGate.isTechnical = true;

      const hasSpecificIssue =
        Boolean(this.cleanText(nextIntentGate.detectedDeviceLabel)) &&
        Boolean(
          this.cleanText(
            nextIntentGate.detectedIssueLabel || nextIntentGate.detectedErrorCode,
          ),
        );

      nextIntentGate.isTechnicalSpecific = hasSpecificIssue;
      nextIntentGate.isTechnicalVague = !hasSpecificIssue;

      if (!hasSpecificIssue && nextIntentGate.intent === 'NORMAL') {
        nextIntentGate.intent = 'TECHNICAL_VAGUE';
      }

      if (hasSpecificIssue && nextIntentGate.intent === 'NORMAL') {
        nextIntentGate.intent = 'TECHNICAL_SPECIFIC';
      }
    }

    if (
      currentDevice &&
      extractedDevice &&
      currentDevice !== extractedDevice &&
      this.hasEnoughConfidence(
        input.extraction.confidence?.device,
        input.extraction.confidence?.overall,
      )
    ) {
      nextState.detectedOtherDevices = [
        ...new Set([...(nextState.detectedOtherDevices || []), extractedDevice]),
      ];
    }

    return {
      prevState: nextState,
      intentGate: nextIntentGate,
    };
  }

  private hasEnoughConfidence(
    confidence?: number,
    overallConfidence?: number,
  ) {
    return (
      (typeof confidence === 'number' && confidence >= 0.65) ||
      (typeof overallConfidence === 'number' && overallConfidence >= 0.8)
    );
  }

  private shouldAttemptStructuredExtraction(input: {
    originalText: string;
    prevState: Record<string, any> | null;
    intentGate: Record<string, any>;
  }) {
    if (input.intentGate?.isEmergency) {
      return false;
    }

    const currentDevice = this.cleanText(input.prevState?.device);
    const ruleDevice = this.cleanText(input.intentGate?.detectedDeviceLabel);
    const ruleSymptom = this.cleanText(
      input.intentGate?.detectedIssueLabel || input.intentGate?.detectedErrorCode,
    );
    const hasMultipleDeviceSignals = this.hasMultipleDeviceSignals(
      input.originalText,
    );

    if (currentDevice && ruleDevice && currentDevice !== ruleDevice) {
      return false;
    }

    if (ruleDevice && ruleSymptom && !hasMultipleDeviceSignals) {
      return false;
    }

    const normalizedText = this.normalizeText(input.originalText);
    const isLongMessage = input.originalText.trim().length >= 80;
    const hasMultipleClauses =
      /[,;:]|\bnhung\b|\bma\b|\bvan\b|\broi\b|\bxong\b|\bhinh nhu\b/u.test(
        normalizedText,
      );
    const hasProblemSignal =
      /\bkhong\b|\bhu\b|\bloi\b|\bvan de\b|\bmat\b|\blanh\b|\bnong\b|\bnuoc\b|\bgio\b|\bden\b|\bquay\b|\bkhong thoat\b|\bhut yeu\b/u.test(
        normalizedText,
      );

    return (
      hasMultipleDeviceSignals ||
      (hasProblemSignal &&
        (isLongMessage || hasMultipleClauses || !ruleDevice || !ruleSymptom))
    );
  }

  private hasMultipleDeviceSignals(originalText: string) {
    const lowerText = originalText.toLowerCase();
    const devicePatterns = [
      /(máy lạnh|may lanh|điều hòa|dieu hoa)/u,
      /(máy giặt|may giat)/u,
      /(tủ lạnh|tu lanh|cái tủ|cai tu|tủ đông|tu dong)/u,
      /(lò vi sóng|lo vi song)/u,
      /(máy rửa bát|may rua bat)/u,
      /(bếp từ|bep tu)/u,
    ];

    let matches = 0;

    for (const pattern of devicePatterns) {
      if (pattern.test(lowerText)) {
        matches += 1;
      }
    }

    return matches >= 2;
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

  private async buildConversationContext(input: {
    userId: number;
    sessionId: number | null;
    prevState: Record<string, any> | null;
  }) {
    const devices = await this.prisma.device.findMany({
      where: {
        userId: input.userId,
      },
      select: {
        category: true,
        brandName: true,
        modelCode: true,
      },
    });

    const sessionContext = input.sessionId
      ? await this.prisma.chatSession.findFirst({
          where: {
            id: input.sessionId,
            userId: input.userId,
          },
          select: {
            status: true,
            deviceType: true,
            device: {
              select: {
                category: true,
                brandName: true,
                modelCode: true,
              },
            },
          },
        })
      : null;

    if (sessionContext && sessionContext.status !== 'AI_CONSULTING') {
      throw new BadRequestException(
        'Phiên chẩn đoán AI này đã đóng hoặc đã chuyển sang bước đặt thợ. Không thể chat thêm trong phiên này.',
      );
    }

    const deviceContext =
      devices.length > 0
        ? `\n[THÔNG TIN THIẾT BỊ KHÁCH HÀNG]: Khách hàng có: ${devices
            .map((device) =>
              [device.brandName, device.category].filter(Boolean).join(' '),
            )
            .join(', ')}`
        : '\n[THÔNG TIN THIẾT BỊ KHÁCH HÀNG]: Chưa có thiết bị nào được lưu trong hồ sơ.';

    const user = await this.prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        role: true,
      },
    });

    const accessLevel: AccessLevel =
      user?.role === UserRole.TECHNICIAN || user?.role === UserRole.ADMIN
        ? AccessLevel.ADVANCED
        : AccessLevel.BASIC;

    const lastStateContext = input.prevState
      ? `\n[TRẠNG THÁI HIỆN TẠI]: ${JSON.stringify(input.prevState)}`
      : '\n[TRẠNG THÁI HIỆN TẠI]: Phiên chat mới, chưa có trạng thái trước đó.';

    return {
      devices,
      sessionContext,
      deviceContext,
      accessLevel,
      lastStateContext,
    };
  }

  private async retrieveRagChunks(input: {
    query: string;
    prevState: Record<string, any> | null;
    accessLevel: AccessLevel;
    devices: Array<{
      category: string;
      brandName: string;
      modelCode: string | null;
    }>;
    sessionContext: {
      status: string;
      deviceType: string | null;
      device: {
        category: string;
        brandName: string;
        modelCode: string | null;
      } | null;
    } | null;
  }): Promise<any[]> {
    try {
      const fallbackDevice =
        input.devices.length === 1 ? input.devices[0] : null;
      const primaryDevice = input.sessionContext?.device || fallbackDevice;

      const categoryFilter =
        input.prevState?.deviceCategory ||
        input.sessionContext?.deviceType ||
        primaryDevice?.category ||
        input.prevState?.device ||
        null;

      const brandFilter =
        primaryDevice?.brandName || input.prevState?.brand || null;
      const modelCodeFilter =
        primaryDevice?.modelCode || input.prevState?.model || null;

      let ragRes = await this.ragRetrievalService.findRelevantChunks({
        query: input.query,
        accessLevel: input.accessLevel,
        limit: RAG_LIMITS.DEFAULT_RETRIEVAL_LIMIT,
        minScore: RAG_LIMITS.MIN_RETRIEVAL_SCORE,
        category: categoryFilter,
        brand: brandFilter,
        modelCode: modelCodeFilter,
      });

      let results = ragRes.results as any[];

      if (
        results.length === 0 &&
        (categoryFilter || brandFilter || modelCodeFilter)
      ) {
        ragRes = await this.ragRetrievalService.findRelevantChunks({
          query: input.query,
          accessLevel: input.accessLevel,
          limit: RAG_LIMITS.DEFAULT_RETRIEVAL_LIMIT,
          minScore: RAG_LIMITS.MIN_RETRIEVAL_SCORE,
        });

        results = ragRes.results as any[];
      }

      this.aiResponseBuilderService.prioritizeChunksByErrorCode(
        input.query,
        results,
      );

      return results;
    } catch (error) {
      this.logger.error('Lỗi khi gọi RAG:', error);
      return [];
    }
  }

  private async buildRlhfInstruction(category: string): Promise<string> {
    const examples =
      await this.aiConversationPersistenceService.getGoldenExamples(
        category,
        2,
      );

    const goldenExamples = examples?.golden ?? [];
    const negativeExample = examples?.negative ?? null;

    if (goldenExamples.length === 0 && !negativeExample) {
      return '';
    }

    this.logger.log(
      `RLHF injected ${goldenExamples.length} golden example(s) for category "${category}"`,
    );

    const goldenText = goldenExamples
      .map(
        (log, index) =>
          `   [Tốt #${index + 1}] Khách: "${log.userMsg}"\n   AI: "${(
            log.aiResponse ?? ''
          ).substring(0, 300)}..."`,
      )
      .join('\n\n');

    const negativeText = negativeExample
      ? `   [Xấu] Khách: "${negativeExample.userMsg}"\n   AI: "${(
          negativeExample.aiResponse ?? ''
        ).substring(0, 300)}..."`
      : '';
    return `
[VÍ DỤ TRẢ LỜI XUẤT SẮC ĐỂ CHỐT ĐƠN]:
${goldenText || '   (Chưa có)'}

[VÍ DỤ CẦN TRÁNH GÂY KHÓ CHỊU CHO KHÁCH]:
${negativeText || '   (Chưa có)'}
`;
  }
}
