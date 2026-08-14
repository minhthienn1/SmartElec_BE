import { Injectable } from '@nestjs/common';

const SAFETY_PATTERNS: Array<[RegExp, string]> = [
  [/\bboc khoi\b|\bco khoi\b/u, 'Có khói hoặc bốc khói'],
  [/\bmui khet\b/u, 'Có mùi khét'],
  [/\btia lua\b|\bxet lua\b|\bnet lua\b/u, 'Có tia lửa'],
  [/\bro dien\b|\bgiat dien\b|\bchap dien\b/u, 'Có dấu hiệu rò/chập điện'],
  [/\btieng no\b|\bno nho\b/u, 'Có tiếng nổ bất thường'],
  [/\bnuoc .*o dien\b|\bro nuoc gan nguon dien\b/u, 'Nước rò gần nguồn điện'],
];

@Injectable()
export class AiSafetyPolicyService {
  // Phát hiện dấu hiệu nguy hiểm từ câu tự nhiên đã hoặc chưa chuẩn hóa dấu.
  detectSigns(text: string): string[] {
    const normalized = this.normalize(text);
    const detected = SAFETY_PATTERNS.filter(([pattern]) =>
      pattern.test(normalized),
    ).map(([, label]) => label);

    if (
      /\bbi chay\b|\bdang chay\b|\bchay roi\b|\bchay khet\b/u.test(normalized) &&
      !detected.includes('Có dấu hiệu cháy')
    ) {
      detected.push('Có dấu hiệu cháy');
    }

    return detected;
  }

  // Chỉ tạo cảnh báo khi có dấu hiệu an toàn hoặc mức rủi ro cao.
  buildWarning(safetySigns: unknown, risk: unknown): string | null {
    if (!this.cleanText(safetySigns) && risk !== 'HIGH' && risk !== 'RED') {
      return null;
    }

    return 'Bạn nên ngắt nguồn thiết bị ngay, không tiếp tục sử dụng và không tự tháo nếu chưa có chuyên môn.';
  }

  // Đưa cảnh báo lên trước nội dung tư vấn để không bị câu hỏi context che khuất.
  prepend(text: string, warning?: string | null): string {
    return warning ? `${warning}\n\n${text}` : text;
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalize(value: string): string {
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
