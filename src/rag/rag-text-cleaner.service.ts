import { BadRequestException, Injectable } from '@nestjs/common';

const DEFAULT_MOJIBAKE_BLOCK_THRESHOLD = 0.15;
const MIN_TEXT_LENGTH_FOR_ENCODING_CHECK = 120;
const MOJIBAKE_PATTERN =
  /�|Ã[\u00a0-\uffff]?|Â[^\sA-Za-zÀ-ỹ]|â[€€™€œ€¢€“”]|áº|á»|Æ|º|»/g;

@Injectable()
export class RagTextCleanerService {
  clean(text: string): string {
    if (!text) {
      return '';
    }

    const normalized = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/^\uFEFF/, '');

    return normalized
      .split('\n')
      .map((line) => this.cleanLine(line))
      .filter((line) => this.shouldKeepLine(line))
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  assertEncodingQuality(
    text: string,
    threshold = DEFAULT_MOJIBAKE_BLOCK_THRESHOLD,
  ): void {
    // Chặn tài liệu có tỷ lệ ký tự lỗi mã hóa quá cao để tránh tạo chunk/embedding bẩn.
    const ratio = this.calculateMojibakeRatio(text);

    if (ratio > threshold) {
      throw new BadRequestException(
        'Nội dung tài liệu có dấu hiệu lỗi mã hóa ký tự vượt quá 15%. Vui lòng kiểm tra lại file hoặc xuất lại dưới định dạng UTF-8 trước khi import.',
      );
    }
  }

  calculateMojibakeRatio(text: string): number {
    // Tính tỷ lệ dấu hiệu mojibake trên phần text nhìn thấy, bỏ qua khoảng trắng.
    if (!text) {
      return 0;
    }

    const visibleText = text.replace(/\s+/g, '');
    if (visibleText.length < MIN_TEXT_LENGTH_FOR_ENCODING_CHECK) {
      // File quá ngắn dễ là model/mã lỗi kỹ thuật, không đủ dữ liệu để kết luận lỗi encoding.
      return 0;
    }

    const matches = Array.from(
      visibleText.matchAll(MOJIBAKE_PATTERN),
      (match) => match[0],
    );
    const suspiciousChars = matches.reduce(
      (total, match) => total + match.length,
      0,
    );

    return suspiciousChars / visibleText.length;
  }

  private cleanLine(line: string): string {
    const preservedIndent = line.match(/^\s*/)?.[0] ?? '';

    const cleaned = line
      .trimEnd()
      .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gi, '')
      .replace(/Error!\s*Bookmark\s*not\s*defined\.?/gi, '')
      .replace(/Error!\s*Reference\s*source\s*not\s*found\.?/gi, '')
      .replace(/\.{4,}\s*\d+\s*$/g, '')
      .replace(/\.{5,}/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trimEnd();

    if (!cleaned.trim()) {
      return '';
    }

    // Giữ lại indentation vừa phải cho bullet/list để không làm phẳng cấu trúc.
    if (/^\s*[-*+•◦]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      return `${preservedIndent}${cleaned.trimStart()}`.trimEnd();
    }

    return cleaned.trim();
  }

  private isLikelyTechnicalShortLine(line: string): boolean {
    const compact = line.trim();

    if (!compact || compact.length > 80) {
      return false;
    }

    return (
      /^[A-Z]{1,4}\d{0,4}([-_/][A-Z0-9]{1,6})?$/i.test(compact) ||
      /^\d+([.,]\d+)?\s?(v|w|kw|a|ma|hz|rpm|mm|cm|m|kg|bar|psi|°c|%)$/i.test(compact) ||
      /^[A-Z]?\d{1,4}([.-][A-Z0-9]{1,6})?$/.test(compact)
    );
  }

  private shouldKeepLine(line: string): boolean {
    const trimmed = line.trim();

    if (!trimmed) {
      return false;
    }

    if (this.isLikelyTechnicalShortLine(trimmed)) {
      return true;
    }

    if (/^\d+$/.test(trimmed)) {
      return false;
    }

    if (/^\d+\s+\d+$/.test(trimmed)) {
      return false;
    }

    if (/^[-–—_=*•·]{4,}$/.test(trimmed)) {
      return false;
    }

    if (/^\.{4,}$/.test(trimmed)) {
      return false;
    }

    if (/^\d+(\.\d+)*\s*[:.)-]?\s*$/.test(trimmed)) {
      return false;
    }

    const meaningfulChars = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
    if (trimmed.length >= 10 && meaningfulChars.length < 3) {
      return false;
    }

    return true;
  }
}
