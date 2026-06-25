import { Injectable } from '@nestjs/common';

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
