import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RagFileType } from '@prisma/client';
import { extname } from 'path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE } from './rag.constants';
import { normalizeRagFilename } from './rag-filename.util';

type ParsedRagSegment = {
  title?: string;
  section?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
};

type ParsedRagFile = {
  fileType: RagFileType;
  content: string;
  metadata?: Record<string, unknown>;
  segments?: ParsedRagSegment[];
};

type SpreadsheetCellValue = string | number | boolean | Date | null | undefined;

type SpreadsheetRow = string[];

@Injectable()
export class RagFileParserService {
  private readonly logger = new Logger(RagFileParserService.name);

  private readonly maxRowsPerCsv = 1000;
  private readonly maxRowsPerSheet = 500;
  private readonly maxSpreadsheetCellLength = 800;

  inferFileType(file: Express.Multer.File): RagFileType {
    const originalName = normalizeRagFilename(file.originalname || '');
    const extension = extname(originalName).toLowerCase();
    const mimeType = (file.mimetype || '').toLowerCase();

    if (extension === '.txt' || mimeType === 'text/plain') {
      return RagFileType.TXT;
    }

    if (
      extension === '.md' ||
      extension === '.markdown' ||
      mimeType === 'text/markdown'
    ) {
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

    if (
      extension === '.docx' ||
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return RagFileType.DOCX;
    }

    if (
      extension === '.xlsx' ||
      mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return RagFileType.XLSX;
    }

    if (extension === '.pdf' || mimeType === 'application/pdf') {
      return RagFileType.PDF;
    }

    throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
  }

  private normalizeFileName(file: Express.Multer.File): string {
    const originalFileName = normalizeRagFilename(file.originalname || '');

    /*
      Gán lại để các bước parse/log phía sau đều dùng filename đã sửa mojibake.
      Ingestion service cũng nên làm tương tự trước khi upload.
    */
    file.originalname = originalFileName;

    return originalFileName;
  }

  private normalizeRawText(text: string): string {
    return text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  private ensureText(
    text: string,
    errorMessage: string,
    minimumLength = 20,
  ): string {
    const normalized = this.normalizeRawText(text);

    if (normalized.length < minimumLength) {
      throw new BadRequestException(errorMessage);
    }

    return normalized;
  }

  private stripExtension(filename: string): string {
    return filename.replace(/\.[^.]+$/, '');
  }

  private truncateValue(value: string, maxLength = this.maxSpreadsheetCellLength) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trim()}...`;
  }

  private convertCellValue(value: SpreadsheetCellValue): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return this.truncateValue(String(value).trim());
  }

  private normalizeRows(rawRows: SpreadsheetCellValue[][]): SpreadsheetRow[] {
    return rawRows
      .map((row) => row.map((cell) => this.convertCellValue(cell)))
      .filter((row) => row.some((cell) => cell.length > 0));
  }

  private detectHeaderRow(rows: SpreadsheetRow[]): boolean {
    const firstRow = rows[0];
    const secondRow = rows[1];

    if (!firstRow || firstRow.length === 0) {
      return false;
    }

    const normalized = firstRow
      .map((cell) => cell.trim().toLowerCase())
      .filter((cell) => cell.length > 0);

    if (normalized.length === 0) {
      return false;
    }

    const uniqueCount = new Set(normalized).size;
    const isMostlyUnique = uniqueCount >= Math.max(1, normalized.length - 1);
    const hasNonNumericLabel = normalized.some((cell) =>
      Number.isNaN(Number(cell)),
    );

    if (!secondRow) {
      return isMostlyUnique && hasNonNumericLabel;
    }

    const usefulHeaderCells = normalized.filter((cell, index) => {
      const nextValue = secondRow[index]?.trim().toLowerCase() ?? '';

      return cell.length > 0 && cell.length <= 80 && nextValue !== cell;
    }).length;

    return isMostlyUnique && hasNonNumericLabel && usefulHeaderCells > 0;
  }

  private buildRowSegment(params: {
    parser: 'csv' | 'xlsx';
    titlePrefix: string;
    section: string;
    headers: string[];
    row: SpreadsheetRow;
    rowIndex: number;
    extraMetadata?: Record<string, unknown>;
  }): ParsedRagSegment | null {
    const { parser, titlePrefix, section, headers, row, rowIndex, extraMetadata } =
      params;

    const pairs = row
      .map((value, columnIndex) => {
        if (!value) {
          return null;
        }

        const key = headers[columnIndex]?.trim() || `Cột ${columnIndex + 1}`;

        return `- ${key}: ${value}`;
      })
      .filter((item): item is string => Boolean(item));

    if (pairs.length === 0) {
      return null;
    }

    return {
      title: `${titlePrefix} - Dòng ${rowIndex}`,
      section,
      content: `${section}\nDòng ${rowIndex}:\n${pairs.join('\n')}`,
      metadata: {
        parser,
        headers,
        rowIndex,
        rowRange: `${rowIndex}-${rowIndex}`,
        ...extraMetadata,
      },
    };
  }

  private parseTxt(file: Express.Multer.File): ParsedRagFile {
    this.normalizeFileName(file);

    const content = this.ensureText(
      file.buffer.toString('utf-8'),
      'File TXT không có nội dung hợp lệ để import.',
      1,
    );

    return {
      fileType: RagFileType.TXT,
      content,
      metadata: {
        parser: 'txt',
      },
    };
  }

  private flushMarkdownSegment(params: {
    segments: ParsedRagSegment[];
    title?: string;
    headingPath: string[];
    lines: string[];
  }) {
    const { segments, title, headingPath, lines } = params;
    const content = lines.join('\n').trim();

    if (!content) {
      return;
    }

    segments.push({
      title: title || headingPath[headingPath.length - 1] || undefined,
      section:
        headingPath.length > 0 ? headingPath.join(' > ') : title || null,
      content,
      metadata: {
        parser: 'markdown',
        headingPath: headingPath.length > 0 ? [...headingPath] : [],
      },
    });
  }

  private parseMarkdown(file: Express.Multer.File): ParsedRagFile {
    this.normalizeFileName(file);

    const content = this.ensureText(
      file.buffer.toString('utf-8'),
      'File Markdown không có nội dung hợp lệ để import.',
      1,
    );

    const lines = content.split('\n');
    const segments: ParsedRagSegment[] = [];
    const headingPath: string[] = [];
    let currentTitle: string | undefined;
    let currentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);

      if (headingMatch) {
        this.flushMarkdownSegment({
          segments,
          title: currentTitle,
          headingPath,
          lines: currentLines,
        });

        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();

        headingPath.splice(level - 1);
        headingPath[level - 1] = headingText;

        currentTitle = headingText;
        currentLines = [trimmed];
        continue;
      }

      currentLines.push(line);
    }

    this.flushMarkdownSegment({
      segments,
      title: currentTitle,
      headingPath,
      lines: currentLines,
    });

    return {
      fileType: RagFileType.MD,
      content,
      metadata: {
        parser: 'markdown',
      },
      segments: segments.length > 0 ? segments : undefined,
    };
  }

  private parseCsv(file: Express.Multer.File): ParsedRagFile {
    const originalFileName = this.normalizeFileName(file);
    const rawText = this.ensureText(
      file.buffer.toString('utf-8'),
      'File CSV không có dữ liệu để import.',
      1,
    );

    /*
      Dùng XLSX để parse CSV thay vì split(',') thủ công.
      Lý do: CSV có thể có cell dạng "abc, def", dấu ngoặc kép, dòng trống.
    */
    const workbook = XLSX.read(rawText, {
      type: 'string',
      raw: false,
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;

    if (!sheet) {
      throw new BadRequestException('File CSV không có dữ liệu để import.');
    }

    const rawRows = XLSX.utils.sheet_to_json<SpreadsheetCellValue[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });

    const rows = this.normalizeRows(rawRows).slice(0, this.maxRowsPerCsv);

    if (rows.length === 0) {
      throw new BadRequestException('File CSV không có dữ liệu để import.');
    }

    const hasHeaderRow = this.detectHeaderRow(rows);
    const headers = hasHeaderRow
      ? rows[0]
      : rows[0].map((_, columnIndex) => `Cột ${columnIndex + 1}`);
    const dataRows = hasHeaderRow ? rows.slice(1) : rows;
    const csvLabel = `CSV: ${this.stripExtension(originalFileName)}`;

    const segments = dataRows
      .map((row, index) =>
        this.buildRowSegment({
          parser: 'csv',
          titlePrefix: csvLabel,
          section: csvLabel,
          headers,
          row,
          rowIndex: index + (hasHeaderRow ? 2 : 1),
        }),
      )
      .filter((segment): segment is ParsedRagSegment => Boolean(segment));

    const fallbackContent = this.ensureText(
      rows.map((row) => row.join(', ')).join('\n'),
      'File CSV không có dữ liệu để import.',
      1,
    );

    return {
      fileType: RagFileType.CSV,
      content:
        segments.length > 0
          ? segments.map((segment) => segment.content).join('\n\n')
          : fallbackContent,
      metadata: {
        parser: 'csv',
        headers,
        rowCount: dataRows.length,
        truncated: rawRows.length > this.maxRowsPerCsv,
      },
      segments: segments.length > 0 ? segments : undefined,
    };
  }

  private async parseDocx(file: Express.Multer.File): Promise<ParsedRagFile> {
    const originalFileName = this.normalizeFileName(file);

    const result = await mammoth.extractRawText({ buffer: file.buffer });

    if (result.messages.length > 0) {
      this.logger.warn(
        `DOCX parser warnings for ${originalFileName}: ${result.messages
          .map((message) => message.message)
          .join(' | ')}`,
      );
    }

    const content = this.ensureText(
      result.value,
      'File DOCX không có nội dung text hợp lệ.',
    );

    return {
      fileType: RagFileType.DOCX,
      content,
      metadata: {
        parser: 'docx',
      },
    };
  }

  private parseXlsx(file: Express.Multer.File): ParsedRagFile {
    this.normalizeFileName(file);

    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      raw: false,
      cellDates: true,
    });

    const segments: ParsedRagSegment[] = [];
    const sheetNames: string[] = [];
    let totalRows = 0;
    let truncated = false;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];

      if (!sheet) {
        continue;
      }

      const rawRows = XLSX.utils.sheet_to_json<SpreadsheetCellValue[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
      });

      if (rawRows.length > this.maxRowsPerSheet) {
        truncated = true;
      }

      const rows = this.normalizeRows(rawRows).slice(0, this.maxRowsPerSheet);

      if (rows.length === 0) {
        continue;
      }

      sheetNames.push(sheetName);

      const hasHeaderRow = this.detectHeaderRow(rows);
      const headers = hasHeaderRow
        ? rows[0]
        : rows[0].map((_, columnIndex) => `Cột ${columnIndex + 1}`);
      const dataRows = hasHeaderRow ? rows.slice(1) : rows;

      dataRows.forEach((row, index) => {
        const rowIndex = index + (hasHeaderRow ? 2 : 1);
        const segment = this.buildRowSegment({
          parser: 'xlsx',
          titlePrefix: `Sheet: ${sheetName}`,
          section: `Sheet: ${sheetName}`,
          headers,
          row,
          rowIndex,
          extraMetadata: {
            sheetName,
          },
        });

        if (!segment) {
          return;
        }

        totalRows += 1;
        segments.push(segment);
      });
    }

    if (segments.length === 0) {
      throw new BadRequestException('File XLSX không có dữ liệu text hợp lệ.');
    }

    return {
      fileType: RagFileType.XLSX,
      content: segments.map((segment) => segment.content).join('\n\n'),
      metadata: {
        parser: 'xlsx',
        sheetNames,
        rowCount: totalRows,
        truncated,
      },
      segments,
    };
  }

  private async parsePdf(file: Express.Multer.File): Promise<ParsedRagFile> {
    const originalFileName = this.normalizeFileName(file);

    const parser = new PDFParse({ data: file.buffer });
    const result = await parser.getText();

    const content = this.ensureText(
      result.text,
      'PDF này không có lớp text hoặc cần OCR, hiện hệ thống chưa hỗ trợ OCR.',
    );

    this.logger.log(
      `Đã tách văn bản PDF cho ${originalFileName} với ${result.total} trang`,
    );

    return {
      fileType: RagFileType.PDF,
      content,
      metadata: {
        parser: 'pdf',
        pageCount: result.total,
      },
    };
  }

  async parse(file: Express.Multer.File): Promise<ParsedRagFile> {
    const fileType = this.inferFileType(file);

    switch (fileType) {
      case RagFileType.TXT:
        return this.parseTxt(file);

      case RagFileType.MD:
        return this.parseMarkdown(file);

      case RagFileType.CSV:
        return this.parseCsv(file);

      case RagFileType.DOCX:
        return this.parseDocx(file);

      case RagFileType.XLSX:
        return this.parseXlsx(file);

      case RagFileType.PDF:
        return this.parsePdf(file);

      default:
        throw new BadRequestException(RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE);
    }
  }
}