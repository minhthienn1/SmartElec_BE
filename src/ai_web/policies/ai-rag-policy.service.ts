import { Injectable } from '@nestjs/common';
import type {
  ContextAnswerKey,
  ContextAnswers,
} from '../extraction/ai-context-collector.service';

const MINIMUM_CONTEXT_KEYS: ContextAnswerKey[] = [
  'operationStatus',
  'errorCode',
  'abnormalSigns',
  'whenHappens',
  'safetySigns',
];

@Injectable()
export class AiRagPolicyService {
  // Chỉ mở RAG khi có context tối thiểu và symptom đủ tin cậy.
  canUse(input: { symptom: string | null; contextAnswers: ContextAnswers }): boolean {
    const hasMinimumContext = MINIMUM_CONTEXT_KEYS.some((key) =>
      this.clean(input.contextAnswers[key]),
    );
    if (!hasMinimumContext) return false;
    if (!this.isGenericSymptom(input.symptom)) return true;
    return this.hasStrongContext(input.contextAnswers);
  }

  // Kết hợp thiết bị, triệu chứng và context thành truy vấn semantic RAG.
  buildQuery(input: {
    device: string;
    symptom: string;
    contextAnswers: ContextAnswers;
  }): string {
    const values = [
      input.contextAnswers.operationStatus,
      input.contextAnswers.errorCode,
      input.contextAnswers.abnormalSigns,
      input.contextAnswers.whenHappens,
      input.contextAnswers.safetySigns,
      input.contextAnswers.maintenanceHistory,
      input.contextAnswers.environmentCondition,
      input.contextAnswers.brandModel,
    ].map((value) => this.clean(value)).filter(Boolean);
    return [input.device, input.symptom, ...values].join(' | ');
  }

  private isGenericSymptom(symptom: string | null): boolean {
    const normalized = this.normalize(this.clean(symptom));
    return /^(bi hu|bi loi|co van de|hong|hong hoc)$/.test(normalized);
  }

  private hasStrongContext(answers: ContextAnswers): boolean {
    return Boolean(
      this.clean(answers.errorCode) || this.clean(answers.abnormalSigns) ||
      this.clean(answers.whenHappens) || this.clean(answers.safetySigns) ||
      this.clean(answers.outdoorUnitStatus),
    );
  }

  private clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalize(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }
}
