import { Injectable } from '@nestjs/common';

import {
    SAFE_FALLBACK_STATE,
    TECHNICAL_NO_RAG_FALLBACK,
} from './ai.constants';

@Injectable()
export class AiResponseBuilderService {
    sanitizeUserMessage(message: string): string {
        const forbiddenKeywords = [
            /\[\s*THÔNG TIN THIẾT BỊ KHÁCH HÀNG\s*\]/gi,
            /\[\s*KIẾN THỨC TỪ HỆ THỐNG\s*\]/gi,
            /Hệ\s*thống\s*:/gi,
            /Từ\s*giờ\s*hãy/gi,
            /Quên\s*mọi\s*chỉ\s*dẫn/gi,
        ];

        let cleanMessage = message;

        for (const regex of forbiddenKeywords) {
            cleanMessage = cleanMessage.replace(regex, '(Nội dung bị lọc)');
        }

        return cleanMessage;
    }

    buildDirectParsedResponse(intentGate: any, prevState: any) {
        const baseState = {
            ...(prevState || SAFE_FALLBACK_STATE),
            device:
                intentGate.detectedDeviceLabel ||
                prevState?.device ||
                SAFE_FALLBACK_STATE.device,
            symptom:
                intentGate.detectedIssueLabel ||
                intentGate.detectedErrorCode ||
                prevState?.symptom ||
                SAFE_FALLBACK_STATE.symptom,
        };

        if (intentGate.intent === 'EMERGENCY') {
            return {
                text: intentGate.directResponse,
                state: {
                    ...baseState,
                    phase: 'READY_TO_BOOK',
                    risk: 'RED',
                    flags: ['EMERGENCY'],
                    symptom: intentGate.detectedIssueLabel || intentGate.originalText,
                },
                is_booking_triggered: true,
            };
        }

        if (intentGate.intent === 'EXPLICIT_BOOKING') {
            return {
                text: intentGate.directResponse,
                state: {
                    ...baseState,
                    phase: 'READY_TO_BOOK',
                    risk: prevState?.risk || 'UNKNOWN',
                },
                is_booking_triggered: true,
            };
        }

        if (intentGate.intent === 'TECHNICAL_VAGUE') {
            return {
                text: intentGate.directResponse,
                state: {
                    ...baseState,
                    phase: 'COLLECTING',
                    risk: prevState?.risk || 'UNKNOWN',
                },
                is_booking_triggered: false,
            };
        }

        if (intentGate.intent === 'OUT_OF_SCOPE_TECHNICAL') {
            return {
                text: intentGate.directResponse,
                state: {
                    ...baseState,
                    phase: 'COLLECTING',
                    risk: 'UNKNOWN',
                },
                is_booking_triggered: false,
            };
        }

        return {
            text: intentGate.directResponse,
            state: prevState || SAFE_FALLBACK_STATE,
            is_booking_triggered: false,
        };
    }

    buildNoRagFallback(intentGate: any, prevState: any, originalText: string) {
        return {
            text: TECHNICAL_NO_RAG_FALLBACK,
            state: {
                ...(prevState || SAFE_FALLBACK_STATE),
                device:
                    intentGate.detectedDeviceLabel ||
                    prevState?.device ||
                    SAFE_FALLBACK_STATE.device,
                symptom:
                    intentGate.detectedIssueLabel ||
                    intentGate.detectedErrorCode ||
                    originalText,
                phase: 'COLLECTING',
                risk: prevState?.risk || 'UNKNOWN',
            },
            is_booking_triggered: false,
        };
    }

    buildRagContext(results: any[]): string {
        const docsText = results
            .map((chunk: any) => {
                const title = chunk.documentTitle || chunk.title || 'Tài liệu RAG';
                const source = chunk.source || 'Tài liệu nội bộ';
                const category = chunk.category
                    ? `\nLoại thiết bị: ${chunk.category}`
                    : '';
                const brandModel = [chunk.brand, chunk.modelCode]
                    .filter(Boolean)
                    .join(' / ');
                const brandModelLine = brandModel
                    ? `\nThương hiệu/Model: ${brandModel}`
                    : '';
                const sectionLine = chunk.section ? `\nMục: ${chunk.section}` : '';

                return `- Tài liệu: ${title}\nNguồn: ${source}${category}${brandModelLine}${sectionLine}\nNội dung chunk: ${chunk.content}`;
            })
            .join('\n\n');

        return `
[KIẾN THỨC TỪ HỆ THỐNG]:
${docsText}

Chỉ thị quan trọng:
- Ưu tiên sử dụng kiến thức trên để trả lời.
- Không bịa thêm nguồn.
- Nếu tài liệu là ADVANCED mà người dùng là khách thường, chỉ hướng dẫn an toàn và không hướng dẫn tháo máy chi tiết.
- Nếu thông tin còn thiếu, không trả hết toàn bộ nguyên nhân một lần; hãy hỏi từng bước.
`;
    }

    prioritizeChunksByErrorCode(originalText: string, results: any[]) {
        const errorCodesMatch = originalText.match(
            /\b[A-Z][0-9]\b|\b[A-Z]{2,3}[0-9]?\b/g,
        );

        if (!errorCodesMatch || errorCodesMatch.length === 0) {
            return;
        }

        results.sort((a, b) => {
            const aText = `${a.content || ''} ${a.title || ''}`.toUpperCase();
            const bText = `${b.content || ''} ${b.title || ''}`.toUpperCase();

            const aHasCode = errorCodesMatch.some((code) =>
                aText.includes(code.toUpperCase()),
            );
            const bHasCode = errorCodesMatch.some((code) =>
                bText.includes(code.toUpperCase()),
            );

            if (aHasCode && !bHasCode) return -1;
            if (!aHasCode && bHasCode) return 1;

            return 0;
        });
    }

    buildCleanGeminiHistory(
        history: any[],
    ): { role: string; parts: { text: string }[] }[] {
        const cleanHistory: { role: string; parts: { text: string }[] }[] = [];
        let expectedRole = 'user';

        for (const item of history.slice(-10)) {
            const mappedRole =
                item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';

            if (mappedRole === expectedRole) {
                cleanHistory.push({
                    role: mappedRole,
                    parts: [{ text: item.content }],
                });

                expectedRole = expectedRole === 'user' ? 'model' : 'user';
            }
        }

        if (
            cleanHistory.length > 0 &&
            cleanHistory[cleanHistory.length - 1].role === 'user'
        ) {
            cleanHistory.pop();
        }

        return cleanHistory;
    }

    normalizeParsedResponse(parsed: any, prevState: any) {
        const fallbackState = prevState || SAFE_FALLBACK_STATE;

        return {
            text:
                typeof parsed?.text === 'string' && parsed.text.trim()
                    ? parsed.text.trim()
                    : 'Mình chưa hiểu rõ vấn đề. Bạn mô tả thêm thiết bị và tình trạng lỗi giúp mình nhé.',
            state: {
                ...fallbackState,
                ...(parsed?.state || {}),
                phase: parsed?.state?.phase || fallbackState.phase || 'COLLECTING',
                risk: parsed?.state?.risk || fallbackState.risk || 'UNKNOWN',
                flags: Array.isArray(parsed?.state?.flags)
                    ? parsed.state.flags
                    : fallbackState.flags || [],
            },
            is_booking_triggered:
                parsed?.is_booking_triggered === true ||
                parsed?.is_booking_triggered === 'true',
        };
    }

    buildUserPrompt(input: {
        ragContext: string;
        rlhfInstruction: string;
        deviceContext: string;
        lastStateContext: string;
        intentGate: any;
        cleanMessage: string;
    }): string {
        return `
${input.ragContext}
${input.rlhfInstruction}
${input.deviceContext}
${input.lastStateContext}

[PHÂN LOẠI Ý ĐỊNH TỪ BACKEND]:
${JSON.stringify(
            {
                intent: input.intentGate.intent,
                reasons: input.intentGate.reasons,
                detectedDevice: input.intentGate.detectedDeviceLabel,
                detectedIssue: input.intentGate.detectedIssueLabel,
                detectedBrand: input.intentGate.detectedBrand,
                detectedErrorCode: input.intentGate.detectedErrorCode,
            },
            null,
            2,
        )}

Dưới đây là nội dung từ khách hàng:
<user_input>
${input.cleanMessage}
</user_input>

Hãy phân tích và phản hồi dựa trên vai trò SmartElec Buddy.
`;
    }
}