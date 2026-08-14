/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { JobStatus, MessageType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { evaluateAiUsefulness } from './ai-usefulness-scoring';

export type AiConversationState = Record<string, any>;

export type AiFeedback = 'LIKE' | 'DISLIKE';

export interface AiParsedResponse {
    text?: string;
    state?: AiConversationState | null;
    is_booking_triggered?: boolean | string;
}

interface FinalizeResponseInput {
    userId: number;
    sessionId: number | null;
    message: string;
    prevState: AiConversationState | null;
    parsed: AiParsedResponse;
}

@Injectable()
export class AiConversationPersistenceService {
    private readonly logger = new Logger(AiConversationPersistenceService.name);

    constructor(private readonly prisma: PrismaService) {
        // Dùng Prisma để lưu state, transcript, phiên tư vấn và phản hồi AI của website.
    }

    async getPreviousState(
        userId: number,
        sessionId: number | null,
    ): Promise<AiConversationState | null> {
        // Khôi phục state gần nhất của đúng user và session để hội thoại nhiều lượt không mất ngữ cảnh.
        if (!sessionId) {
            return null;
        }

        const lastLog = await this.prisma.aiReasoningLog.findFirst({
            where: {
                userId,
                sessionId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        const nextState = lastLog?.nextState;

        if (!this.isPlainObject(nextState)) {
            return null;
        }

        return nextState as AiConversationState;
    }

    async finalizeDirectResponse(input: FinalizeResponseInput) {
        // Hoàn tất một response bằng cách đồng bộ session, reasoning log và transcript trước khi trả về FE.
        const sessionId = await this.persistRepairCaseIfNeeded({
            userId: input.userId,
            sessionId: input.sessionId,
            parsed: input.parsed,
            fallbackMessage: input.message,
        });

        const logId = await this.saveReasoningLog(
            input.userId,
            sessionId,
            input.message,
            input.prevState,
            input.parsed,
        );

        await this.persistTranscriptMessages({
            sessionId,
            userId: input.userId,
            userMessage: input.message,
            aiResponse: input.parsed?.text,
        });

        return {
            ...input.parsed,
            sessionId,
            logId,
        };
    }

    async finalizeAiResponse(input: FinalizeResponseInput) {
        // Dùng chung pipeline persistence cho response do Gemini/RAG tạo ra và response deterministic.
        return this.finalizeDirectResponse(input);
    }

    async saveFeedback(logId: number, feedback: AiFeedback) {
        // Ghi LIKE/DISLIKE theo kiểu idempotent và cập nhật điểm hữu ích đúng một lần cho mỗi log.
        const log = await this.prisma.aiReasoningLog.findUnique({
            where: {
                id: logId,
            },
        });

        if (!log) {
            throw new Error(`Không tìm thấy AI log với ID = ${logId}`);
        }

        if (log.aiFeedback === 'LIKE' || log.aiFeedback === 'DISLIKE') {
            return {
                success: true,
                feedback: log.aiFeedback,
                alreadySubmitted: true,
            };
        }

        const scoreIncrement = feedback === 'LIKE' ? 2 : -5;
        const usefulnessEvaluation = evaluateAiUsefulness({
            prevState: this.toPlainState(log.prevState),
            nextState: this.toPlainState(log.nextState),
            aiResponse: log.aiResponse,
            aiFeedback: feedback,
        });

        await this.prisma.aiReasoningLog.update({
            where: {
                id: logId,
            },
            data: {
                aiFeedback: feedback,
                score: {
                    increment: scoreIncrement,
                },
                autoUsefulnessScore: usefulnessEvaluation.autoUsefulnessScore,
                autoUsefulnessLabel: usefulnessEvaluation.autoUsefulnessLabel,
                autoUsefulnessReasons: usefulnessEvaluation.autoUsefulnessReasons,
            },
        });

        this.logger.log(
            `User #${log.userId} đã ${feedback} log #${logId}. Score cập nhật: ${scoreIncrement > 0 ? '+' : ''
            }${scoreIncrement}`,
        );

        return {
            success: true,
            feedback,
            alreadySubmitted: false,
        };
    }

    async getGoldenExamples(category: string, limit: number = 2) {
        // Lấy ví dụ tốt và một ví dụ kém theo nhóm thiết bị để hỗ trợ prompt/evaluation của AI.
        const golden = await this.prisma.aiReasoningLog.findMany({
            where: {
                deviceCategory: {
                    contains: category,
                    mode: 'insensitive',
                },
                OR: [
                    {
                        score: {
                            gt: 5,
                        },
                    },
                    {
                        isGolden: true,
                    },
                ],
                aiResponse: {
                    not: null,
                },
            },
            orderBy: {
                score: 'desc',
            },
            take: limit,
            select: {
                userMsg: true,
                aiResponse: true,
            },
        });

        const negative = await this.prisma.aiReasoningLog.findFirst({
            where: {
                deviceCategory: {
                    contains: category,
                    mode: 'insensitive',
                },
                score: {
                    lt: 0,
                },
                aiResponse: {
                    not: null,
                },
            },
            orderBy: {
                score: 'asc',
            },
            select: {
                userMsg: true,
                aiResponse: true,
            },
        });

        return {
            golden,
            negative,
        };
    }

    async saveReasoningLog(
        userId: number,
        sessionId: number | null,
        userMsg: string,
        prevState: AiConversationState | null,
        parsed: AiParsedResponse,
    ): Promise<number | null> {
        // Lưu snapshot trước/sau, response, risk và điểm hữu ích để truy vết chất lượng từng lượt AI.
        try {
            const state = this.toPlainState(parsed?.state);

            const isBooking =
                parsed?.is_booking_triggered === true ||
                parsed?.is_booking_triggered === 'true';

            const score = isBooking ? 10 : 0;
            const deviceCategory = this.getStringValue(state?.device);
            const riskLevel = this.getStringValue(state?.risk) || 'UNKNOWN';
            const usefulnessEvaluation = evaluateAiUsefulness({
                prevState,
                nextState: state,
                aiResponse: parsed?.text,
                aiFeedback: null,
            });

            const log = await this.prisma.aiReasoningLog.create({
                data: {
                    userId,
                    sessionId,
                    userMsg,
                    prevState: prevState || null,
                    nextState: state || null,
                    riskLevel,
                    aiResponse: parsed?.text || '',
                    score,
                    autoUsefulnessScore: usefulnessEvaluation.autoUsefulnessScore,
                    autoUsefulnessLabel: usefulnessEvaluation.autoUsefulnessLabel,
                    autoUsefulnessReasons: usefulnessEvaluation.autoUsefulnessReasons,
                    deviceCategory,
                    isGolden: isBooking,
                },
            });

            return log.id;
        } catch (error) {
            this.logger.error('Error saving reasoning log to DB', error);
            return null;
        }
    }

    private async persistRepairCaseIfNeeded(input: {
        userId: number;
        sessionId: number | null;
        parsed: AiParsedResponse;
        fallbackMessage: string;
    }): Promise<number | null> {
        // Chỉ tạo hoặc cập nhật ChatSession khi state đã đủ device + symptom hoặc đã kích hoạt đặt thợ.
        const state = this.toPlainState(input.parsed?.state);

        const isBooking =
            input.parsed?.is_booking_triggered === true ||
            input.parsed?.is_booking_triggered === 'true';

        const hasDeviceAndSymptom = Boolean(state?.device && state?.symptom);

        if (!isBooking && !hasDeviceAndSymptom) {
            return input.sessionId;
        }

        const deviceType = this.getStringValue(state?.device) || 'thiết bị';
        const symptom =
            this.getStringValue(state?.symptom) || input.fallbackMessage;
        const summary =
            this.getStringValue(state?.aiSummaryText) ||
            this.getStringValue(state?.finalAiSummary?.analysis) ||
            symptom ||
            input.fallbackMessage;

        return this.saveRepairCase(
            input.userId,
            deviceType,
            symptom,
            summary,
            input.sessionId,
        );
    }

    private async saveRepairCase(
        userId: number,
        deviceType: string,
        symptom: string,
        summary: string,
        sessionId?: number | null,
    ): Promise<number | null> {
        // Ưu tiên cập nhật session hiện tại, kế đến ca gần đây cùng thiết bị, cuối cùng mới tạo session mới.
        try {
            if (sessionId) {
                const existingCase = await this.prisma.chatSession.findUnique({
                    where: {
                        id: sessionId,
                    },
                });

                if (existingCase) {
                    const updated = await this.prisma.chatSession.update({
                        where: {
                            id: sessionId,
                        },
                        data: {
                            deviceType,
                            symptom,
                            aiSummary: summary,
                        },
                    });

                    return updated.id;
                }
            }

            const recentCase = await this.prisma.chatSession.findFirst({
                where: {
                    userId,
                    deviceType,
                    createdAt: {
                        gte: new Date(Date.now() - 1000 * 60 * 30),
                    },
                },
            });

            if (recentCase) {
                const updated = await this.prisma.chatSession.update({
                    where: {
                        id: recentCase.id,
                    },
                    data: {
                        symptom,
                        aiSummary: summary,
                    },
                });

                return updated.id;
            }

            const newCase = await this.prisma.chatSession.create({
                data: {
                    userId,
                    deviceType,
                    symptom,
                    aiSummary: summary,
                    status: JobStatus.AI_CONSULTING,
                },
            });

            return newCase.id;
        } catch (error) {
            this.logger.error('Lỗi khi lưu/cập nhật ChatSession:', error);
            return null;
        }
    }

    private async persistTranscriptMessages(input: {
        sessionId: number | null;
        userId: number;
        userMessage: string;
        aiResponse?: string | null;
    }) {
        // Lưu cặp tin nhắn user/AI vào bảng Message để lịch sử web có thể hydrate lại sau khi tải trang.
        if (!input.sessionId) {
            return;
        }

        const userMessage = input.userMessage?.trim();
        const aiResponse = input.aiResponse?.trim();

        if (!userMessage && !aiResponse) {
            return;
        }

        try {
            const data: Array<{
                sessionId: number;
                senderId?: number | null;
                type: MessageType;
                content: string;
                metadata?: Prisma.JsonValue | null;
            }> = [];

            if (userMessage) {
                data.push({
                    sessionId: input.sessionId,
                    senderId: input.userId,
                    type: MessageType.TEXT,
                    content: userMessage,
                    metadata: { aiTranscript: true },
                });
            }

            if (aiResponse) {
                data.push({
                    sessionId: input.sessionId,
                    senderId: null,
                    type: MessageType.TEXT,
                    content: aiResponse,
                    metadata: { aiTranscript: true },
                });
            }

            if (data.length > 0) {
                await this.prisma.message.createMany({
                    data,
                });
            }
        } catch (error) {
            this.logger.error(
                `Lỗi khi persist transcript cho session #${input.sessionId}`,
                error,
            );
        }
    }

    private toPlainState(value: unknown): AiConversationState | null {
        // Chỉ nhận object thuần làm conversation state, loại bỏ array và giá trị nguyên thủy.
        if (!this.isPlainObject(value)) {
            return null;
        }

        return value as AiConversationState;
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        // Kiểm tra runtime cho object state trước khi đọc hoặc ghi sang Prisma JSON.
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    private getStringValue(value: unknown): string | null {
        // Chuẩn hóa một field state về chuỗi không rỗng hoặc null.
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }

        return null;
    }
}
