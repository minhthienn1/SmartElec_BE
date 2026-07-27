import { Injectable, Logger } from '@nestjs/common';
import { JobStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Kết quả gợi ý "case cũ có liên quan" trả về cho Flutter.
 * Đây là dữ liệu PHỤ, không thay đổi luồng chẩn đoán chính của AI.
 */
export interface RelatedHistorySummary {
    sessionId: number;
    deviceType: string | null;
    brand: string | null;
    modelCode: string | null;
    symptom: string | null;
    aiSummary: string | null;
    status: JobStatus;
    createdAt: Date;
    /**
     * Cho biết độ tin cậy của match, để Flutter tuỳ ý style khác nhau nếu muốn
     * (VD: DEVICE_ID thì hiện chắc chắn hơn CATEGORY_ONLY).
     */
    matchedBy: 'DEVICE_ID' | 'BRAND_CATEGORY' | 'CATEGORY_ONLY';
}

export interface FindRelatedCaseInput {
    userId: number;
    /** Session hiện tại — luôn loại trừ khỏi kết quả để không tự gợi ý chính nó. */
    currentSessionId: number | null;
    /** Mạnh nhất: cùng trỏ về 1 Device thật trong bảng devices. */
    deviceId?: number | null;
    /** Nhãn thiết bị do AI trích xuất, VD: "Điều hòa", "Máy giặt". */
    deviceType?: string | null;
    /** Gợi ý thương hiệu dạng text tự do, VD: từ contextAnswers.brandModel. */
    brandHint?: string | null;
}

const ELIGIBLE_STATUSES: JobStatus[] = [
    JobStatus.COMPLETED,
    JobStatus.DONE,
    JobStatus.IN_PROGRESS,
    JobStatus.MATCHED,
    JobStatus.AI_CONSULTING,
];

const LOOKBACK_DAYS = 180;

@Injectable()
export class AiRelatedHistoryService {
    private readonly logger = new Logger(AiRelatedHistoryService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Không so khớp nội dung tin nhắn (text similarity). Chỉ dựa vào dữ liệu
     * có cấu trúc, theo thứ tự ưu tiên giảm dần:
     *   1) Cùng deviceId thật (chắc chắn nhất — cùng 1 thiết bị vật lý).
     *   2) Cùng deviceType + brand gợi ý khớp nhau.
     *   3) Chỉ cùng deviceType (category) — fallback yếu nhất.
     * Luôn chỉ lấy 1 kết quả gần nhất để không "spam" gợi ý.
     */
    async findRelatedCase(
        input: FindRelatedCaseInput,
    ): Promise<RelatedHistorySummary | null> {
        try {
            const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

            const baseWhere = {
                userId: input.userId,
                isHiddenByCustomer: false,
                status: { in: ELIGIBLE_STATUSES },
                createdAt: { gte: since },
                ...(input.currentSessionId
                    ? { NOT: { id: input.currentSessionId } }
                    : {}),
            };

            // ── Cấp 1: khớp CHÍNH XÁC theo deviceId ─────────────────────────
            if (input.deviceId) {
                const exact = await this.prisma.chatSession.findFirst({
                    where: { ...baseWhere, deviceId: input.deviceId },
                    orderBy: { createdAt: 'desc' },
                });
                if (exact) return this.toSummary(exact, 'DEVICE_ID');
            }

            const deviceType = input.deviceType?.trim();
            if (!deviceType) return null;

            // ── Cấp 2: cùng deviceType + brand gợi ý khớp nhau ──────────────
            const brandHint = input.brandHint?.trim();
            if (brandHint && brandHint.length >= 2) {
                const brandMatch = await this.prisma.chatSession.findFirst({
                    where: {
                        ...baseWhere,
                        deviceType: { equals: deviceType, mode: 'insensitive' },
                        brand: { contains: brandHint, mode: 'insensitive' },
                    },
                    orderBy: { createdAt: 'desc' },
                });
                if (brandMatch) return this.toSummary(brandMatch, 'BRAND_CATEGORY');
            }

            // ── Cấp 3: chỉ khớp theo loại thiết bị ───────────────────────────
            const categoryMatch = await this.prisma.chatSession.findFirst({
                where: {
                    ...baseWhere,
                    deviceType: { equals: deviceType, mode: 'insensitive' },
                },
                orderBy: { createdAt: 'desc' },
            });
            if (categoryMatch) return this.toSummary(categoryMatch, 'CATEGORY_ONLY');

            return null;
        } catch (error) {
            // Đây là tính năng gợi ý phụ — lỗi ở đây KHÔNG được làm hỏng luồng chat chính.
            this.logger.warn('Không thể tra cứu lịch sử liên quan', error as Error);
            return null;
        }
    }

    /**
     * Cố gắng tìm deviceId thật của khách dựa trên category + brand gợi ý.
     * Trả về null nếu khách chưa từng đăng ký thiết bị này trong app — vẫn
     * bình thường, lúc đó findRelatedCase() sẽ tự rơi xuống Cấp 2/3.
     */
    async resolveDeviceId(
        userId: number,
        deviceType: string | null,
        brandHint: string | null,
    ): Promise<number | null> {
        if (!deviceType) return null;
        try {
            const device = await this.prisma.device.findFirst({
                where: {
                    userId,
                    category: { equals: deviceType, mode: 'insensitive' },
                    ...(brandHint && brandHint.trim().length >= 2
                        ? { brandName: { contains: brandHint.trim(), mode: 'insensitive' } }
                        : {}),
                },
                orderBy: { updatedAt: 'desc' },
            });
            return device?.id ?? null;
        } catch (error) {
            this.logger.warn('Không thể resolve deviceId', error as Error);
            return null;
        }
    }

    private toSummary(
        session: {
            id: number;
            deviceType: string | null;
            brand: string | null;
            modelCode: string | null;
            symptom: string | null;
            aiSummary: string | null;
            status: JobStatus;
            createdAt: Date;
        },
        matchedBy: RelatedHistorySummary['matchedBy'],
    ): RelatedHistorySummary {
        return {
            sessionId: session.id,
            deviceType: session.deviceType,
            brand: session.brand,
            modelCode: session.modelCode,
            symptom: session.symptom,
            aiSummary: session.aiSummary,
            status: session.status,
            createdAt: session.createdAt,
            matchedBy,
        };
    }
}