import { Injectable } from '@nestjs/common';

@Injectable()
export class RagTextCleanerService {
  clean(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
