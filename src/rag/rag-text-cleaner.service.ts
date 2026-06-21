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
    return line
      .trim()

      // Xóa marker trang kiểu: -- 27 of 66 --
      .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gi, '')

      // Xóa lỗi bookmark/reference của Word/PDF.
      .replace(/Error!\s*Bookmark\s*not\s*defined\.?/gi, '')
      .replace(/Error!\s*Reference\s*source\s*not\s*found\.?/gi, '')

      // Xóa dotted leader kiểu mục lục.
      // Ví dụ: "1.8. Ổ đĩa mềm ............ 12"
      .replace(/\.{4,}\s*\d+\s*$/g, '')

      // Xóa dotted leader còn sót giữa dòng.
      .replace(/\.{5,}/g, ' ')

      // Gom khoảng trắng.
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private shouldKeepLine(line: string): boolean {
    if (!line) {
      return false;
    }

    // Bỏ dòng chỉ có số trang.
    if (/^\d+$/.test(line)) {
      return false;
    }

    // Bỏ dòng chỉ có 2 số rời kiểu: "11 19".
    if (/^\d+\s+\d+$/.test(line)) {
      return false;
    }

    // Bỏ dòng trang trí.
    if (/^[-–—_=*•·]{4,}$/.test(line)) {
      return false;
    }

    // Bỏ dòng chỉ toàn dấu chấm.
    if (/^\.{4,}$/.test(line)) {
      return false;
    }

    // Bỏ dòng sau khi xóa Error Bookmark mà chỉ còn mục lục ngắn/rỗng rác.
    // Ví dụ: "1 :" hoặc "1.8. Ổ đĩa mềm .."
    if (/^\d+(\.\d+)*\s*[:.)-]?\s*$/.test(line)) {
      return false;
    }

    // Bỏ dòng nhiều ký tự nhưng gần như không có chữ/số có nghĩa.
    const meaningfulChars = line.replace(/[^A-Za-zÀ-ỹ0-9]/g, '');

    if (line.length >= 10 && meaningfulChars.length < 3) {
      return false;
    }

    return true;
  }
}