import { Injectable, Logger } from '@nestjs/common';
import { JobStatus, MessageType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

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

    constructor(private readonly prisma: PrismaService) { }

    async getPreviousState(
        userId: number,
        sessionId: number | null,
    ): Promise<AiConversationState | null> {
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
        return this.finalizeDirectResponse(input);
    }

    async saveFeedback(logId: number, feedback: AiFeedback) {
        const log = await this.prisma.aiReasoningLog.findUnique({
            where: {
                id: logId,
            },
        });

        if (!log) {
            throw new Error(`Không tìm thấy AI log với ID = ${logId}`);
        }

        const scoreIncrement = feedback === 'LIKE' ? 2 : -5;

        await this.prisma.aiReasoningLog.update({
            where: {
                id: logId,
            },
            data: {
                aiFeedback: feedback,
                score: {
                    increment: scoreIncrement,
                },
            },
        });

        this.logger.log(
            `User #${log.userId} đã ${feedback} log #${logId}. Score cập nhật: ${scoreIncrement > 0 ? '+' : ''
            }${scoreIncrement}`,
        );

        return {
            success: true,
            feedback,
        };
    }

    async getGoldenExamples(category: string, limit: number = 2) {
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
        try {
            const state = this.toPlainState(parsed?.state);

            const isBooking =
                parsed?.is_booking_triggered === true ||
                parsed?.is_booking_triggered === 'true';

            const score = isBooking ? 10 : 0;
            const deviceCategory = this.getStringValue(state?.device);
            const riskLevel = this.getStringValue(state?.risk) || 'UNKNOWN';

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
        const summary = input.parsed?.text || input.fallbackMessage;

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
            }> = [];

            if (userMessage) {
                data.push({
                    sessionId: input.sessionId,
                    senderId: input.userId,
                    type: MessageType.TEXT,
                    content: userMessage,
                });
            }

            if (aiResponse) {
                data.push({
                    sessionId: input.sessionId,
                    senderId: null,
                    type: MessageType.TEXT,
                    content: aiResponse,
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
        if (!this.isPlainObject(value)) {
            return null;
        }

        return value as AiConversationState;
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    private getStringValue(value: unknown): string | null {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }

        return null;
    }
}
