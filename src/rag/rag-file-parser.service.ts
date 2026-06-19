import { BadRequestException, Injectable } from '@nestjs/common';
import { RagFileType } from '@prisma/client';
import { extname } from 'path';

type ParsedRagFile = {
  fileType: RagFileType;
  content: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class RagFileParserService {
  inferFileType(file: Express.Multer.File): RagFileType {
    const extension = extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype.toLowerCase();

    if (extension === '.txt' || mimeType === 'text/plain') {
      return RagFileType.TXT;
    }

    if (extension === '.md' || mimeType === 'text/markdown') {
      return RagFileType.MD;
    }

    if (
      extension === '.csv' ||
      mimeType === 'text/csv' ||
      mimeType === 'application/csv' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      return RagFileType.CSV;
    }

    throw new BadRequestException('Định dạng file chưa được hỗ trợ ở giai đoạn này');
  }

  parse(file: Express.Multer.File): ParsedRagFile {
    const fileType = this.inferFileType(file);
    const rawText = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');

    if (!rawText.trim()) {
      throw new BadRequestException('File không có nội dung để import');
    }

    if (fileType === RagFileType.CSV) {
      const lines = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        throw new BadRequestException('File CSV không có dữ liệu để import');
      }

      return {
        fileType,
        content: lines.join('\n'),
        metadata: {
          lineCount: lines.length,
        },
      };
    }

    return {
      fileType,
      content: rawText,
    };
  }
}
