import { Injectable } from '@nestjs/common';
import { AiSafetyPolicyService } from '../policies/ai-safety-policy.service';

export type ContextAnswerKey =
  | 'operationStatus'
  | 'errorCode'
  | 'abnormalSigns'
  | 'brandModel'
  | 'whenHappens'
  | 'maintenanceHistory'
  | 'environmentCondition'
  | 'safetySigns'
  | 'outdoorUnitStatus';

export type ContextAnswers = Partial<Record<ContextAnswerKey, string | null>>;

@Injectable()
export class AiContextCollectorService {
  constructor(private readonly safetyPolicy: AiSafetyPolicyService) {}

  // Trích xuất các dữ kiện chẩn đoán rõ ràng từ câu trả lời tự nhiên của khách hàng.
  extract(originalText: string): ContextAnswers {
    const normalized = this.normalize(originalText);
    const errorCodeMatch = originalText.match(/\b[A-Z]{1,3}\s?\d{1,3}\b/i);
    const answers: ContextAnswers = {};

    if (errorCodeMatch?.[0]) {
      answers.errorCode = errorCodeMatch[0].replace(/\s+/g, '').toUpperCase();
    }

    if (/dan lanh co gio|cuc nong khong chay|cuc nong co chay|khong len nguon|(con|van) len nguon|\blen nguon\b|(con|van) chay|hoat dong duoc|hut yeu|khong xa nuoc|khong cap nuoc|den (van )?sang|van co den|dia quay|van quay/u.test(normalized)) {
      answers.operationStatus = this.extractOperationStatus(originalText, normalized);
    }

    if (/tu hom qua|tu hom nay|luc co luc khong|lien tuc|gan day|moi day/u.test(normalized)) {
      answers.whenHappens = originalText.trim();
    }

    if (/da ve sinh|bom gas|thay loi|thay mang loc|di chuyen may/u.test(normalized)) {
      answers.maintenanceHistory = originalText.trim();
    }

    if (/den do|chap nhay|dong tuyet|tieng la|keu to|mui la|ri nuoc|ro nuoc/u.test(normalized)) {
      answers.abnormalSigns = originalText.trim();
    }

    const safetySigns = this.safetyPolicy.detectSigns(originalText);
    if (safetySigns.length > 0) {
      answers.safetySigns = safetySigns.join(', ');
    }

    return answers;
  }

  // Gộp dữ kiện mới mà không để null/undefined xóa câu trả lời đã thu thập trước đó.
  merge(previousValue: unknown, nextValue: ContextAnswers): ContextAnswers {
    const previous = this.isPlainObject(previousValue)
      ? (previousValue as ContextAnswers)
      : {};
    const merged: ContextAnswers = { ...previous };

    for (const [key, value] of Object.entries(nextValue) as Array<
      [ContextAnswerKey, string | null | undefined]
    >) {
      if (typeof value === 'string' && value.trim()) {
        merged[key] = value.trim();
      }
    }

    return merged;
  }

  // Chọn duy nhất câu follow-up quan trọng nhất còn thiếu trong question set hiện tại.
  pickFollowupKey(questionSet: string, answers: ContextAnswers): ContextAnswerKey | null {
    if (questionSet === 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL') {
      const status = this.cleanText(answers.operationStatus).toLowerCase();
      if (status.includes('dàn lạnh có gió') && !status.includes('cục nóng')) {
        return 'outdoorUnitStatus';
      }
      if (status.includes('cục nóng')) return null;
      if (!this.cleanText(answers.errorCode) && !this.cleanText(answers.abnormalSigns)) return 'errorCode';
      return null;
    }

    if (questionSet === 'COOKING_APPLIANCE::GENERIC') {
      if (!this.cleanText(answers.operationStatus)) return 'operationStatus';
      if (!this.cleanText(answers.safetySigns)) return 'safetySigns';
      return null;
    }

    if (!this.cleanText(answers.operationStatus)) return 'operationStatus';
    if (!this.cleanText(answers.errorCode) && !this.cleanText(answers.abnormalSigns)) return 'errorCode';
    return null;
  }

  private extractOperationStatus(originalText: string, normalized: string): string {
    const segments: string[] = [];
    if (/dan lanh co gio/u.test(normalized)) segments.push('dàn lạnh có gió');
    if (/cuc nong khong chay/u.test(normalized)) segments.push('cục nóng không chạy');
    if (/cuc nong co chay/u.test(normalized)) segments.push('cục nóng có chạy');
    if (/khong len nguon/u.test(normalized)) segments.push('không lên nguồn');
    if (/\b(con|van) len nguon\b|\blen nguon\b|hoat dong duoc/u.test(normalized)) segments.push('còn lên nguồn');
    if (/\b(con|van) chay\b/u.test(normalized)) segments.push('vẫn chạy');
    if (/den (van )?sang|van co den/u.test(normalized)) segments.push('đèn vẫn sáng');
    if (/dia quay|van quay/u.test(normalized)) segments.push('đĩa vẫn quay');
    if (/hut yeu/u.test(normalized)) segments.push('hút yếu');
    if (/khong xa nuoc/u.test(normalized)) segments.push('không xả nước');
    if (/khong cap nuoc/u.test(normalized)) segments.push('không cấp nước');
    return segments.length > 0 ? segments.join(', ') : originalText.trim();
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalize(value: string): string {
    return (value ?? '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
