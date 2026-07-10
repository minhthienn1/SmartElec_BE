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
      let effectiveState = prevState;
      let ragQuery = originalText;
      let safetyWarning: string | null = null;

      if (intentGate.isTechnical) {
        const guidedDiagnosis =
          this.aiGuidedDiagnosisService.resolveNextStep({
            originalText,
            prevState,
            intentGate,
          });

        if (guidedDiagnosis.action === 'DIRECT_RESPONSE') {
          return this.aiConversationPersistenceService.finalizeDirectResponse({
            userId,
            sessionId,
            message: originalText,
            prevState,
            parsed: guidedDiagnosis.parsedResponse,
          });
        }

        effectiveState = guidedDiagnosis.nextState;
        ragQuery = guidedDiagnosis.ragQuery;
        safetyWarning = guidedDiagnosis.safetyWarning || null;
      }

      if (intentGate.shouldReturnDirectResponse && intentGate.directResponse) {
        const parsed =
          this.aiResponseBuilderService.buildDirectParsedResponse(
            intentGate,
            effectiveState,
          );

        return this.aiConversationPersistenceService.finalizeDirectResponse({
          userId,
          sessionId,
          message: originalText,
          prevState,
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
        intentGate.shouldUseRag || effectiveState?.phase === 'READY_FOR_RAG';

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
            intentGate,
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
            prevState,
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
        intentGate,
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
        prevState,
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
