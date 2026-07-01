import { Injectable } from '@nestjs/common';

@Injectable()
export class AiGuidedDiagnosisService {
    resolveNextStep(input: {
        originalText: string;
        prevState: any;
        intentGate: any;
        ragChunks: any[];
    }): { shouldAskStepByStep: boolean; parsedResponse: any | null } {
        const currentFlow = input.prevState?.diagnosisFlow;

        if (
            currentFlow?.mode === 'GUIDED_DIAGNOSIS' &&
            currentFlow?.nextAction === 'SUGGEST_BOOKING'
        ) {
            const normalizedText = (input.originalText || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();

            if (/^(co|co giup toi voi|giup toi voi|ok|dong y|dat tho giup toi|goi tho giup toi)$/.test(normalizedText)) {
                return {
                    shouldAskStepByStep: false,
                    parsedResponse: {
                        text: 'Mình đã ghi nhận bạn đồng ý tạo yêu cầu đặt thợ.\n\nMình sẽ chuyển sang bước đặt lịch để bạn điền thông tin liên hệ và thời gian mong muốn.',
                        state: {
                            ...input.prevState,
                            phase: 'READY_TO_BOOK',
                            diagnosisFlow: { ...currentFlow, nextAction: 'END' },
                        },
                        is_booking_triggered: true,
                    },
                };
            }
        }

        if (currentFlow?.mode === 'GUIDED_DIAGNOSIS') {
            return this.continueFlow(input);
        }

        if (!this.shouldStartGuidedDiagnosis(input)) {
            return {
                shouldAskStepByStep: false,
                parsedResponse: null,
            };
        }

        return this.buildInitialFlow(input);
    }

    private shouldStartGuidedDiagnosis(input: {
        intentGate: any;
        ragChunks: any[];
    }): boolean {
        if (input.intentGate.intent !== 'TECHNICAL_SPECIFIC') {
            return false;
        }

        return input.ragChunks.length >= 2;
    }

    private buildInitialFlow(input: {
        originalText: string;
        prevState: any;
        intentGate: any;
        ragChunks: any[];
    }) {
        const device =
            input.intentGate.detectedDeviceLabel ||
            input.prevState?.device ||
            'thiết bị';

        const symptom =
            input.intentGate.detectedIssueLabel ||
            input.intentGate.detectedErrorCode ||
            input.originalText;

        const firstQuestion = this.buildFirstQuestion(device, symptom);

        const diagnosisFlow = {
            mode: 'GUIDED_DIAGNOSIS',
            currentStep: 1,
            currentQuestion: firstQuestion,
            askedQuestions: [firstQuestion],
            missingFields: this.inferMissingFields(device),
            collectedInfo: {
                deviceCategory: device,
                issueDescription: symptom,
                userAnswers: {},
            },
            nextAction: 'ASK_ONE_QUESTION',
        };

        return {
            shouldAskStepByStep: true,
            parsedResponse: {
                text: [
                    'Mình sẽ kiểm tra theo từng bước để tránh đoán sai.',
                    '',
                    `Bước 1: ${firstQuestion}`,
                ].join('\n'),
                state: {
                    ...(input.prevState || {}),
                    device,
                    symptom,
                    phase: 'DIAGNOSING',
                    risk: input.prevState?.risk || 'UNKNOWN',
                    flags: input.prevState?.flags || [],
                    diagnosisFlow,
                },
                is_booking_triggered: false,
            },
        };
    }

    private continueFlow(input: {
        originalText: string;
        prevState: any;
        intentGate: any;
        ragChunks: any[];
    }) {
        const oldFlow = input.prevState?.diagnosisFlow;

        const userAnswers = {
            ...(oldFlow?.collectedInfo?.userAnswers || {}),
            [`step_${oldFlow.currentStep}`]: input.originalText,
        };

        const nextStep = Number(oldFlow.currentStep || 1) + 1;

        if (nextStep > 3) {
            const diagnosisFlow = {
                ...oldFlow,
                currentStep: nextStep,
                collectedInfo: {
                    ...(oldFlow.collectedInfo || {}),
                    userAnswers,
                },
                nextAction: 'SUGGEST_BOOKING',
            };

            return {
                shouldAskStepByStep: true,
                parsedResponse: {
                    text: [
                        'Mình đã ghi nhận thêm thông tin bạn cung cấp.',
                        '',
                        'Với tình trạng này, để tránh kiểm tra sai hoặc bỏ sót lỗi phần cứng, bạn nên để kỹ thuật viên kiểm tra trực tiếp.',
                        '',
                        'Bạn có muốn mình hỗ trợ tạo yêu cầu đặt thợ không?',
                    ].join('\n'),
                    state: {
                        ...input.prevState,
                        phase: 'READY_TO_BOOK',
                        diagnosisFlow,
                    },
                    is_booking_triggered: false,
                },
            };
        }

        const nextQuestion = this.buildQuestionByStep(
            input.prevState?.device || input.intentGate.detectedDeviceLabel,
            nextStep,
        );

        const diagnosisFlow = {
            ...oldFlow,
            currentStep: nextStep,
            currentQuestion: nextQuestion,
            askedQuestions: [...(oldFlow.askedQuestions || []), nextQuestion],
            collectedInfo: {
                ...(oldFlow.collectedInfo || {}),
                userAnswers,
            },
            nextAction: 'ASK_ONE_QUESTION',
        };

        return {
            shouldAskStepByStep: true,
            parsedResponse: {
                text: [
                    'Mình đã ghi nhận thông tin bạn vừa cung cấp.',
                    '',
                    `Bước ${nextStep}: ${nextQuestion}`,
                ].join('\n'),
                state: {
                    ...input.prevState,
                    phase: 'DIAGNOSING',
                    diagnosisFlow,
                },
                is_booking_triggered: false,
            },
        };
    }

    private buildFirstQuestion(device: string, symptom: string): string {
        const text = `${device} ${symptom}`.toLowerCase();

        if (text.includes('máy lạnh') || text.includes('điều hòa')) {
            return 'Bạn cho mình biết cục lạnh trong phòng có thổi gió không, và cục nóng bên ngoài có chạy không?';
        }

        if (text.includes('máy giặt')) {
            return 'Bạn cho mình biết máy đang lỗi ở bước nào: cấp nước, giặt, xả nước hay vắt?';
        }

        if (text.includes('tủ lạnh')) {
            return 'Bạn cho mình biết ngăn mát và ngăn đá hiện còn lạnh không, hay cả hai đều không lạnh?';
        }

        if (text.includes('điện') || text.includes('ổ điện')) {
            return 'Bạn cho mình biết khu vực đó có mùi khét, nóng bất thường, tia lửa hoặc aptomat nhảy không?';
        }

        return 'Bạn mô tả thêm giúp mình thiết bị còn hoạt động một phần hay đã ngừng hẳn nhé?';
    }

    private buildQuestionByStep(device: string, step: number): string {
        const text = (device || '').toLowerCase();

        if (text.includes('máy lạnh') || text.includes('điều hòa')) {
            if (step === 2) {
                return 'Khi bật máy lạnh, bạn có nghe tiếng cục nóng chạy hoặc thấy quạt cục nóng quay không?';
            }

            return 'Máy lạnh có báo mã lỗi, chớp đèn hoặc có mùi khét gì không?';
        }

        if (text.includes('máy giặt')) {
            if (step === 2) {
                return 'Máy có báo mã lỗi trên màn hình không? Nếu có, mã lỗi là gì?';
            }

            return 'Lỗi này xảy ra liên tục hay chỉ thỉnh thoảng mới bị?';
        }

        if (text.includes('tủ lạnh')) {
            if (step === 2) {
                return 'Bạn có nghe block/máy nén phía sau tủ chạy không?';
            }

            return 'Tủ có đóng tuyết, chảy nước hoặc có mùi khét không?';
        }

        return 'Lỗi này xảy ra liên tục hay chỉ thỉnh thoảng mới bị?';
    }

    private inferMissingFields(device: string): string[] {
        const text = (device || '').toLowerCase();

        if (text.includes('máy lạnh') || text.includes('điều hòa')) {
            return ['indoorFanStatus', 'outdoorUnitStatus', 'errorCode'];
        }

        if (text.includes('máy giặt')) {
            return ['failedStage', 'errorCode', 'frequency'];
        }

        if (text.includes('tủ lạnh')) {
            return ['coolingArea', 'compressorStatus', 'abnormalSigns'];
        }

        return ['deviceStatus', 'errorCode', 'frequency'];
    }
}
