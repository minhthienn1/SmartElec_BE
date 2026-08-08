import { UsefulnessLabel } from '@prisma/client';

type AiConversationState = Record<string, any>;
type AiFeedback = 'LIKE' | 'DISLIKE' | null | undefined;

export type AiUsefulnessEvaluation = {
  autoUsefulnessScore: number;
  autoUsefulnessLabel: UsefulnessLabel;
  autoUsefulnessReasons: string[];
};

const POSITIVE_REASONS = {
  device: 'Đã xác định thêm thiết bị',
  symptom: 'Đã xác định thêm triệu chứng',
  risk: 'Đã xác định thêm mức độ rủi ro',
  context: 'Đã xác định thêm thông tin ngữ cảnh quan trọng',
  phase: 'Trạng thái hội thoại có tiến triển',
  positiveFeedback: 'Người dùng phản hồi tích cực',
} as const;

const NEGATIVE_REASONS = {
  noChange: 'Trạng thái gần như không đổi',
  repeatedQuestion: 'AI hỏi lại thông tin đã có',
  missedWarning: 'Có dấu hiệu bỏ sót cảnh báo nguy hiểm',
  negativeFeedback: 'Người dùng phản hồi tiêu cực',
  phaseBack: 'Giai đoạn hội thoại đi lùi hoặc sai hướng',
} as const;

const PHASE_ORDER: Record<string, number> = {
  COLLECTING: 1,
  ASKING_CONTEXT: 2,
  READY_FOR_RAG: 3,
  DIAGNOSING: 4,
  READY_TO_BOOK: 5,
};

const IMPORTANT_CONTEXT_KEYS = [
  'operationStatus',
  'errorCode',
  'abnormalSigns',
  'brandModel',
  'whenHappens',
  'maintenanceHistory',
  'environmentCondition',
  'safetySigns',
  'outdoorUnitStatus',
] as const;

const DANGER_RISKS = new Set(['RED', 'HIGH', 'CRITICAL']);
const SAFETY_PATTERNS = [
  'ngat nguon',
  'ngắt nguồn',
  'ngat dien',
  'ngắt điện',
  'cau dao',
  'cầu dao',
  'khong tiep tuc su dung',
  'không tiếp tục sử dụng',
  'giu khoang cach',
  'giữ khoảng cách',
  'goi cuu hoa',
  'gọi cứu hỏa',
  'goi dien luc',
  'gọi điện lực',
  'an toan',
  'an toàn',
];

export function evaluateAiUsefulness(input: {
  prevState: AiConversationState | null;
  nextState: AiConversationState | null;
  aiResponse?: string | null;
  aiFeedback?: AiFeedback;
}): AiUsefulnessEvaluation {
  const prevState = toPlainState(input.prevState);
  const nextState = toPlainState(input.nextState);
  const reasons: string[] = [];
  let score = 5;

  const prevDevice = getText(prevState?.device);
  const nextDevice = getText(nextState?.device);
  if (!prevDevice && nextDevice) {
    score += 2;
    reasons.push(POSITIVE_REASONS.device);
  }

  const prevSymptom = getText(prevState?.symptom);
  const nextSymptom = getText(nextState?.symptom);
  if (!prevSymptom && nextSymptom) {
    score += 2;
    reasons.push(POSITIVE_REASONS.symptom);
  }

  const prevRisk = normalizeRisk(prevState?.risk);
  const nextRisk = normalizeRisk(nextState?.risk);
  if ((!prevRisk || prevRisk === 'UNKNOWN') && nextRisk && nextRisk !== 'UNKNOWN') {
    score += 1;
    reasons.push(POSITIVE_REASONS.risk);
  }

  const prevContextCount = countFilledContext(prevState?.contextAnswers);
  const nextContextCount = countFilledContext(nextState?.contextAnswers);
  if (nextContextCount > prevContextCount) {
    score += 1;
    reasons.push(POSITIVE_REASONS.context);
  }

  const phaseDirection = comparePhase(prevState?.phase, nextState?.phase);
  if (phaseDirection > 0) {
    score += 2;
    reasons.push(POSITIVE_REASONS.phase);
  }

  if (input.aiFeedback === 'LIKE') {
    score += 1;
    reasons.push(POSITIVE_REASONS.positiveFeedback);
  }

  if (isAlmostUnchanged(prevState, nextState)) {
    score -= 2;
    reasons.push(NEGATIVE_REASONS.noChange);
  }

  if (askedAlreadyKnownInfo({
    prevState,
    aiResponse: input.aiResponse,
  })) {
    score -= 2;
    reasons.push(NEGATIVE_REASONS.repeatedQuestion);
  }

  if (isMissedDangerWarning({ nextRisk, aiResponse: input.aiResponse })) {
    score -= 3;
    reasons.push(NEGATIVE_REASONS.missedWarning);
  }

  if (input.aiFeedback === 'DISLIKE') {
    score -= 3;
    reasons.push(NEGATIVE_REASONS.negativeFeedback);
  }

  if (phaseDirection < 0) {
    score -= 2;
    reasons.push(NEGATIVE_REASONS.phaseBack);
  }

  const autoUsefulnessScore = clamp(score, 0, 10);

  return {
    autoUsefulnessScore,
    autoUsefulnessLabel: classifyUsefulness(autoUsefulnessScore),
    autoUsefulnessReasons: dedupeReasons(reasons),
  };
}

function classifyUsefulness(score: number): UsefulnessLabel {
  if (score >= 8) {
    return UsefulnessLabel.USEFUL;
  }

  if (score >= 5) {
    return UsefulnessLabel.PARTIAL;
  }

  return UsefulnessLabel.NOT_USEFUL;
}

function askedAlreadyKnownInfo(input: {
  prevState: AiConversationState | null;
  aiResponse?: string | null;
}) {
  const text = normalizeText(input.aiResponse);
  if (!text) {
    return false;
  }

  const hasKnownDevice = Boolean(getText(input.prevState?.device));
  const hasKnownSymptom = Boolean(getText(input.prevState?.symptom));
  const hasKnownErrorCode = Boolean(getText(input.prevState?.contextAnswers?.errorCode));

  const asksDevice =
    text.includes('thiết bị nào') ||
    text.includes('thiet bi nao') ||
    text.includes('máy gì') ||
    text.includes('may gi');
  const asksSymptom =
    text.includes('mô tả rõ hơn lỗi') ||
    text.includes('mo ta ro hon loi') ||
    text.includes('lỗi đang gặp là gì') ||
    text.includes('loi dang gap la gi');
  const asksErrorCode =
    text.includes('mã lỗi') ||
    text.includes('ma loi') ||
    text.includes('đèn nhấp nháy') ||
    text.includes('den nhap nhay');

  return (
    (hasKnownDevice && asksDevice) ||
    (hasKnownSymptom && asksSymptom) ||
    (hasKnownErrorCode && asksErrorCode)
  );
}

function isMissedDangerWarning(input: {
  nextRisk: string | null;
  aiResponse?: string | null;
}) {
  if (!input.nextRisk || !DANGER_RISKS.has(input.nextRisk)) {
    return false;
  }

  const text = normalizeText(input.aiResponse);
  if (!text) {
    return true;
  }

  return !SAFETY_PATTERNS.some((pattern) => text.includes(pattern));
}

function isAlmostUnchanged(
  prevState: AiConversationState | null,
  nextState: AiConversationState | null,
) {
  if (!prevState || !nextState) {
    return false;
  }

  const prevSnapshot = buildStateSnapshot(prevState);
  const nextSnapshot = buildStateSnapshot(nextState);

  return JSON.stringify(prevSnapshot) === JSON.stringify(nextSnapshot);
}

function buildStateSnapshot(state: AiConversationState) {
  return {
    device: getText(state.device),
    symptom: getText(state.symptom),
    risk: normalizeRisk(state.risk),
    phase: getText(state.phase),
    contextAnswers: normalizeContextAnswers(state.contextAnswers),
  };
}

function normalizeContextAnswers(value: unknown) {
  const plain = toPlainState(value);
  const normalized: Record<string, string> = {};

  for (const key of IMPORTANT_CONTEXT_KEYS) {
    const text = getText(plain?.[key]);
    if (text) {
      normalized[key] = text;
    }
  }

  return normalized;
}

function countFilledContext(value: unknown) {
  const plain = toPlainState(value);

  return IMPORTANT_CONTEXT_KEYS.reduce((count, key) => {
    return getText(plain?.[key]) ? count + 1 : count;
  }, 0);
}

function comparePhase(prevPhase: unknown, nextPhase: unknown) {
  const prev = PHASE_ORDER[getText(prevPhase)] ?? 0;
  const next = PHASE_ORDER[getText(nextPhase)] ?? 0;

  if (!prev && !next) {
    return 0;
  }

  if (next > prev) {
    return 1;
  }

  if (next < prev) {
    return -1;
  }

  return 0;
}

function normalizeRisk(value: unknown) {
  const text = getText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function toPlainState(value: unknown): AiConversationState | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AiConversationState)
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dedupeReasons(reasons: string[]) {
  return Array.from(new Set(reasons));
}
