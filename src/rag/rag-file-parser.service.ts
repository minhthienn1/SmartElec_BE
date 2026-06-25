import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RagFileType } from '@prisma/client';
import { extname } from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

import { RAG_LIMITS, RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE } from './rag.constants';
import { normalizeRagFilename } from './rag-filename.util';
import { RagTextCleanerService } from './rag-text-cleaner.service';

export type ParsedRagSegment = {
  title?: string;
  section?: string | null;
  content: string;
  pageNumber?: number | null;
  sheetName?: string | null;
  rowIndex?: number | null;
  metadata?: Record<string, unknown>;
};

export type ParsedRagFile = {
  fileType: RagFileType;
  content: string;
  segments?: ParsedRagSegment[];
  metadata?: Record<string, unknown>;
};

type PdfTextResult = {
  text?: string;
  total?: number;
  numpages?: number;
};

const PDF_SCAN_ERROR_MESSAGE =
  'PDF này là file scan/ảnh, hệ thống chưa hỗ trợ OCR. Vui lòng upload PDF có thể copy chữ, DOCX hoặc TXT.';

@Injectable()
export class RagFileParserService {
  private readonly logger = new Logger(RagFileParserService.name);

  constructor(
    private readonly ragTextCleanerService: RagTextCleanerService,
  ) {}

  async parse(file: Express.Multer.File): Promise<ParsedRagFile> {
    return this.parseFile(file);
  }

  validateInput(file: Express.Multer.File): RagFileType {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file để import RAG.');
    }

    const fileType = this.inferFileType(file);
    if (fileType === RagFileType.UNKNOWN) {
      throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
    }

    this.validateFileSignature(file, fileType);
    return fileType;
  }

  inferFileType(file: Express.Multer.File): RagFileType {
    const extension = this.getFileExtension(file);
    const mimeType = (file.mimetype || '').toLowerCase();

    if (extension === '.pdf' || mimeType.includes('pdf')) {
      return RagFileType.PDF;
    }

    if (extension === '.docx') {
      return RagFileType.DOCX;
    }

    if (extension === '.xlsx') {
      return RagFileType.XLSX;
    }

    if (extension === '.xls') {
      return RagFileType.XLS;
    }

    if (extension === '.csv') {
      return RagFileType.CSV;
    }

    if (extension === '.md' || extension === '.markdown') {
      return RagFileType.MD;
    }

    if (extension === '.txt' || mimeType.startsWith('text/')) {
      return RagFileType.TXT;
    }

    if (extension === '.html' || extension === '.htm') {
      return RagFileType.HTML;
    }

    if (extension === '.json' || mimeType.includes('json')) {
      return RagFileType.JSON;
    }

    return RagFileType.UNKNOWN;
  }

  async parseFile(file: Express.Multer.File): Promise<ParsedRagFile> {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file để import RAG.');
    }

    const fileType = this.inferFileType(file);
    if (fileType === RagFileType.UNKNOWN) {
      throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
    }

    this.validateFileSignature(file, fileType);

    switch (fileType) {
      case RagFileType.PDF:
        return this.parsePdf(file);
      case RagFileType.DOCX:
        return this.parseDocx(file);
      case RagFileType.XLSX:
      case RagFileType.XLS:
        return this.parseWorkbook(file);
      case RagFileType.CSV:
        return this.parseCsv(file);
      case RagFileType.MD:
        return this.parseMarkdown(file);
      case RagFileType.TXT:
        return this.parsePlainText(file);
      case RagFileType.JSON:
        return this.parseJson(file);
      case RagFileType.HTML:
        return this.parseHtml(file);
      default:
        throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
    }
  }

  private getFileExtension(file: Express.Multer.File): string {
    return extname(file.originalname || '').toLowerCase();
  }

  private getOriginalFileName(file: Express.Multer.File): string {
    return normalizeRagFilename(file.originalname || 'unknown-file');
  }

  private hasZipSignature(buffer: Buffer) {
    if (buffer.length < 4) {
      return false;
    }

    return (
      (buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x03 &&
        buffer[3] === 0x04) ||
      (buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x05 &&
        buffer[3] === 0x06) ||
      (buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x07 &&
        buffer[3] === 0x08)
    );
  }

  private hasPdfSignature(buffer: Buffer) {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }

  private looksLikeBinary(buffer: Buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    return sample.includes(0);
  }

  private validateFileSignature(file: Express.Multer.File, fileType: RagFileType) {
    const { buffer } = file;

    switch (fileType) {
      case RagFileType.PDF:
        if (!this.hasPdfSignature(buffer)) {
          throw new BadRequestException('File PDF không hợp lệ hoặc đã bị hỏng.');
        }
        return;
      case RagFileType.DOCX:
      case RagFileType.XLSX:
      case RagFileType.XLS:
        if (!this.hasZipSignature(buffer)) {
          throw new BadRequestException(
            'File bảng tính hoặc tài liệu Office không hợp lệ.',
          );
        }
        return;
      case RagFileType.TXT:
      case RagFileType.MD:
      case RagFileType.CSV:
      case RagFileType.JSON:
      case RagFileType.HTML:
        if (this.looksLikeBinary(buffer)) {
          throw new BadRequestException(
            'File văn bản không hợp lệ hoặc đang chứa dữ liệu nhị phân.',
          );
        }
        return;
      default:
        return;
    }
  }

  private decodeTextFile(file: Express.Multer.File): string {
    return file.buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  private normalizeWhitespace(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private hasMeaningfulText(text: string) {
    const compactText = text.replace(/\s+/g, '');
    const match = compactText.match(/[a-zA-ZÀ-ỹ0-9]/g);
    return Boolean(match && match.length >= 80);
  }

  private async parsePdf(file: Express.Multer.File): Promise<ParsedRagFile> {
    const originalFileName = this.getOriginalFileName(file);

    let result: PdfTextResult;
    try {
      const parser = new PDFParse({ data: file.buffer });
      result = await parser.getText();
    } catch (error) {
      this.logger.warn(
        `Không thể parse PDF ${originalFileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'Không thể đọc nội dung PDF. Vui lòng kiểm tra file hoặc chuyển sang DOCX/TXT.',
      );
    }

    const cleanedText = this.ragTextCleanerService.clean(result.text || '');
    const pageCount = result.total ?? result.numpages ?? null;

    if (!this.hasMeaningfulText(cleanedText)) {
      this.logger.warn(
        `PDF ${originalFileName} không có text layer hợp lệ sau khi parse. pageCount=${
          pageCount ?? 'unknown'
        }`,
      );
      throw new BadRequestException(PDF_SCAN_ERROR_MESSAGE);
    }

    this.logger.log(
      `Đã tách văn bản PDF ${originalFileName}, số trang=${
        pageCount ?? 'unknown'
      }, số ký tự=${cleanedText.length}`,
    );

    return {
      fileType: RagFileType.PDF,
      content: cleanedText,
      metadata: {
        parser: 'pdf-parse',
        pageCount,
        originalFileName,
      },
    };
  }

  private async parseDocx(file: Express.Multer.File): Promise<ParsedRagFile> {
    const originalFileName = this.getOriginalFileName(file);

    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const content = this.normalizeWhitespace(result.value || '');

      if (!content) {
        throw new BadRequestException(
          'File DOCX không có nội dung hợp lệ để import RAG.',
        );
      }

      return {
        fileType: RagFileType.DOCX,
        content,
        metadata: {
          parser: 'mammoth',
          originalFileName,
          messages: result.messages || [],
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn(
        `Không thể parse DOCX ${originalFileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'Không thể đọc nội dung DOCX. Vui lòng kiểm tra lại file.',
      );
    }
  }

  private parseWorkbook(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);

    try {
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: true,
      });

      if (workbook.SheetNames.length === 0) {
        throw new BadRequestException(
          'File bảng tính không có sheet hợp lệ để import RAG.',
        );
      }

      if (workbook.SheetNames.length > RAG_LIMITS.MAX_WORKBOOK_SHEETS) {
        throw new BadRequestException(
          `File bảng tính có quá nhiều sheet. Tối đa cho phép: ${RAG_LIMITS.MAX_WORKBOOK_SHEETS}.`,
        );
      }

      const segments: ParsedRagSegment[] = [];
      const contentParts: string[] = [];
      let totalRows = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          continue;
        }

        const rows = XLSX.utils.sheet_to_json<
          Array<string | number | boolean | Date | null>
        >(sheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });

        const normalizedRows = rows
          .map((row) => row.map((cell) => this.stringifyCell(cell)))
          .filter((row) => row.some((cell) => cell.trim().length > 0));

        if (normalizedRows.length === 0) {
          continue;
        }

        totalRows += normalizedRows.length;
        if (totalRows > RAG_LIMITS.MAX_WORKBOOK_ROWS) {
          throw new BadRequestException(
            `File bảng tính có quá nhiều dòng dữ liệu. Tối đa cho phép: ${RAG_LIMITS.MAX_WORKBOOK_ROWS}.`,
          );
        }

        const header = normalizedRows[0] || [];
        const bodyRows = normalizedRows.slice(1);
        const sheetLines = [`Sheet: ${sheetName}`];

        if (header.length > 0) {
          sheetLines.push(`Columns: ${header.join(' | ')}`);
        }

        bodyRows.forEach((row, index) => {
          const rowNumber = index + 2;
          const line = this.buildSpreadsheetRowText(header, row, rowNumber);
          sheetLines.push(line);

          segments.push({
            title: `${originalFileName} - ${sheetName} - Dòng ${rowNumber}`,
            section: `Sheet: ${sheetName}`,
            content: line,
            sheetName,
            rowIndex: rowNumber,
            metadata: {
              parser: 'xlsx',
              sheetName,
              rowIndex: rowNumber,
              columns: header,
            },
          });
        });

        contentParts.push(sheetLines.join('\n'));
      }

      const content = this.normalizeWhitespace(contentParts.join('\n\n'));
      if (!content) {
        throw new BadRequestException(
          'File bảng tính không có nội dung hợp lệ để import RAG.',
        );
      }

      return {
        fileType:
          this.getFileExtension(file) === '.xls'
            ? RagFileType.XLS
            : RagFileType.XLSX,
        content,
        segments: segments.length > 0 ? segments : undefined,
        metadata: {
          parser: 'xlsx',
          originalFileName,
          sheetNames: workbook.SheetNames,
          rowCount: totalRows,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn(
        `Không thể parse workbook ${originalFileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'Không thể đọc nội dung XLS/XLSX. Vui lòng kiểm tra lại file.',
      );
    }
  }

  private parseCsv(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);

    try {
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        raw: false,
      });

      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
      if (!firstSheet) {
        throw new BadRequestException(
          'File CSV không có nội dung hợp lệ để import RAG.',
        );
      }

      const rows = XLSX.utils.sheet_to_json<
        Array<string | number | boolean | Date | null>
      >(firstSheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      const normalizedRows = rows
        .map((row) => row.map((cell) => this.stringifyCell(cell)))
        .filter((row) => row.some((cell) => cell.trim().length > 0));

      if (normalizedRows.length === 0) {
        throw new BadRequestException(
          'File CSV không có nội dung hợp lệ để import RAG.',
        );
      }

      if (normalizedRows.length > RAG_LIMITS.MAX_WORKBOOK_ROWS) {
        throw new BadRequestException(
          `File CSV có quá nhiều dòng dữ liệu. Tối đa cho phép: ${RAG_LIMITS.MAX_WORKBOOK_ROWS}.`,
        );
      }

      const header = normalizedRows[0] || [];
      const bodyRows = normalizedRows.slice(1);
      const segments: ParsedRagSegment[] = [];
      const lines: string[] = [];

      if (header.length > 0) {
        lines.push(`Columns: ${header.join(' | ')}`);
      }

      bodyRows.forEach((row, index) => {
        const rowNumber = index + 2;
        const line = this.buildSpreadsheetRowText(header, row, rowNumber);
        lines.push(line);

        segments.push({
          title: `${originalFileName} - Dòng ${rowNumber}`,
          section: `CSV: ${originalFileName}`,
          content: line,
          rowIndex: rowNumber,
          metadata: {
            parser: 'csv',
            rowIndex: rowNumber,
            columns: header,
          },
        });
      });

      const content = this.normalizeWhitespace(lines.join('\n'));
      if (!content) {
        throw new BadRequestException(
          'File CSV không có nội dung hợp lệ để import RAG.',
        );
      }

      return {
        fileType: RagFileType.CSV,
        content,
        segments: segments.length > 0 ? segments : undefined,
        metadata: {
          parser: 'xlsx-csv',
          originalFileName,
          rowCount: normalizedRows.length,
          columns: header,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.warn(
        `Không thể parse CSV ${originalFileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'Không thể đọc nội dung CSV. Vui lòng kiểm tra lại file.',
      );
    }
  }

  private parseMarkdown(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);
    const content = this.normalizeWhitespace(this.decodeTextFile(file));

    if (!content) {
      throw new BadRequestException(
        'File Markdown không có nội dung hợp lệ để import RAG.',
      );
    }

    const segments = this.extractMarkdownSegments(content, originalFileName);

    return {
      fileType: RagFileType.MD,
      content,
      segments: segments.length > 0 ? segments : undefined,
      metadata: {
        parser: 'markdown',
        originalFileName,
      },
    };
  }

  private parsePlainText(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);
    const content = this.normalizeWhitespace(this.decodeTextFile(file));

    if (!content) {
      throw new BadRequestException(
        'File TXT không có nội dung hợp lệ để import RAG.',
      );
    }

    return {
      fileType: RagFileType.TXT,
      content,
      metadata: {
        parser: 'plain-text',
        originalFileName,
      },
    };
  }

  private parseJson(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);
    const rawText = this.decodeTextFile(file);

    try {
      const parsed = JSON.parse(rawText);
      const content = this.normalizeWhitespace(JSON.stringify(parsed, null, 2));

      if (!content) {
        throw new BadRequestException(
          'File JSON không có nội dung hợp lệ để import RAG.',
        );
      }

      return {
        fileType: RagFileType.JSON,
        content,
        metadata: {
          parser: 'json',
          originalFileName,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'File JSON không hợp lệ. Vui lòng kiểm tra lại cấu trúc JSON.',
      );
    }
  }

  private parseHtml(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.getOriginalFileName(file);
    const rawHtml = this.decodeTextFile(file);

    const content = this.normalizeWhitespace(
      rawHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    );

    if (!content) {
      throw new BadRequestException(
        'File HTML không có nội dung hợp lệ để import RAG.',
      );
    }

    return {
      fileType: RagFileType.HTML,
      content,
      metadata: {
        parser: 'html-basic',
        originalFileName,
      },
    };
  }

  private stringifyCell(cell: string | number | boolean | Date | null): string {
    if (cell === null || cell === undefined) {
      return '';
    }

    if (cell instanceof Date) {
      return cell.toISOString();
    }

    return String(cell).trim();
  }

  private buildSpreadsheetRowText(
    header: string[],
    row: string[],
    rowNumber: number,
  ) {
    if (header.length === 0) {
      return `Dòng ${rowNumber}: ${row.join(' | ')}`;
    }

    const values = header.map((column, index) => {
      const columnName = column || `Cột ${index + 1}`;
      const value = row[index] || '';
      return `${columnName}: ${value}`;
    });

    return `Dòng ${rowNumber}: ${values.join(' | ')}`;
  }

  private extractMarkdownSegments(
    content: string,
    originalFileName: string,
  ): ParsedRagSegment[] {
    const lines = content.split('\n');
    const segments: ParsedRagSegment[] = [];

    let currentHeadingPath: string[] = [];
    let currentTitle = originalFileName;
    let currentLines: string[] = [];

    const flush = () => {
      const segmentContent = this.normalizeWhitespace(currentLines.join('\n'));
      if (!segmentContent) {
        return;
      }

      segments.push({
        title: currentTitle,
        section: currentHeadingPath.join(' > ') || null,
        content: segmentContent,
        metadata: {
          parser: 'markdown',
          headingPath: currentHeadingPath,
        },
      });

      currentLines = [];
    };

    for (const line of lines) {
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!headingMatch) {
        currentLines.push(line);
        continue;
      }

      flush();

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      currentHeadingPath = currentHeadingPath.slice(0, level - 1);
      currentHeadingPath[level - 1] = headingText;
      currentTitle = headingText || originalFileName;
      currentLines.push(line);
    }

    flush();

    return segments;
  }
}
