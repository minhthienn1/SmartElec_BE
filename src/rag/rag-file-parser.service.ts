import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RagFileType } from '@prisma/client';
import { extname } from 'path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE } from './rag.constants';

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

@Injectable()
export class RagFileParserService {
  private readonly logger = new Logger(RagFileParserService.name);

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

  private ensureText(
    text: string,
    errorMessage: string,
    minimumLength = 20,
  ): string {
    const normalized = text.trim();
    if (normalized.length < minimumLength) {
      throw new BadRequestException(errorMessage);
    }

    return normalized;
  }

  private detectHeaderRow(rows: string[][]): boolean {
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
    const hasNonNumericLabel = normalized.some((cell) => Number.isNaN(Number(cell)));

    if (!secondRow) {
      return isMostlyUnique && hasNonNumericLabel;
    }

    const firstRowLongerCells = normalized.filter((cell, index) => {
      const nextValue = secondRow[index]?.trim() ?? '';
      return cell.length > 0 && cell.length <= 60 && nextValue !== cell;
    }).length;

    return isMostlyUnique && hasNonNumericLabel && firstRowLongerCells > 0;
  }

  private parseTxt(file: Express.Multer.File): ParsedRagFile {
    const content = this.ensureText(
      file.buffer.toString('utf-8').replace(/^\uFEFF/, ''),
      'File TXT khong co noi dung hop le de import',
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

  private flushMarkdownSegment(
    segments: ParsedRagSegment[],
    title: string | undefined,
    headingPath: string[],
    lines: string[],
  ) {
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
    const content = this.ensureText(
      file.buffer.toString('utf-8').replace(/^\uFEFF/, ''),
      'File Markdown khong co noi dung hop le de import',
      1,
    );

    const lines = content.split(/\r?\n/);
    const segments: ParsedRagSegment[] = [];
    const headingPath: string[] = [];
    let currentTitle: string | undefined;
    let currentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (headingMatch) {
        this.flushMarkdownSegment(
          segments,
          currentTitle,
          headingPath,
          currentLines,
        );

        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();
        headingPath.splice(level - 1);
        headingPath[level - 1] = headingText;
        currentTitle = headingText;
        currentLines = [line];
        continue;
      }

      currentLines.push(line);
    }

    this.flushMarkdownSegment(segments, currentTitle, headingPath, currentLines);

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
    const rawText = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new BadRequestException('File CSV khong co du lieu de import');
    }

    const headers = lines[0].split(',').map((header) => header.trim());
    const dataLines = lines.slice(1);
    const csvLabel = `CSV: ${file.originalname.replace(/\.[^.]+$/, '')}`;
    const segments = dataLines
      .map((line, index) => {
        const values = line.split(',').map((value) => value.trim());
        const pairs = headers
          .map((header, columnIndex) => {
            const value = values[columnIndex];
            if (!value) {
              return null;
            }

            return `* ${header || `Cot ${columnIndex + 1}`}: ${value}`;
          })
          .filter((item): item is string => Boolean(item));

        if (pairs.length === 0) {
          return null;
        }

        const rowIndex = index + 2;
        return {
          title: `${csvLabel} - Dong ${rowIndex}`,
          section: csvLabel,
          content: `${csvLabel}\nDong ${rowIndex}:\n${pairs.join('\n')}`,
          metadata: {
            parser: 'csv',
            headers,
            rowIndex,
            rowRange: `${rowIndex}-${rowIndex}`,
          },
        } satisfies ParsedRagSegment;
      })
      .filter(Boolean) as ParsedRagSegment[];

    const fallbackContent = this.ensureText(
      lines.join('\n'),
      'File CSV khong co du lieu de import',
      1,
    );

    return {
      fileType: RagFileType.CSV,
      content: segments.length > 0
        ? segments.map((segment) => segment.content).join('\n\n')
        : fallbackContent,
      metadata: {
        parser: 'csv',
        headers,
        lineCount: lines.length,
      },
      segments: segments.length > 0 ? segments : undefined,
    };
  }

  private async parseDocx(file: Express.Multer.File): Promise<ParsedRagFile> {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    if (result.messages.length > 0) {
      this.logger.warn(
        `DOCX parser warnings for ${file.originalname}: ${result.messages
          .map((message) => message.message)
          .join(' | ')}`,
      );
    }
    const content = this.ensureText(
      result.value.replace(/\r\n/g, '\n'),
      'File DOCX khong co noi dung text hop le.',
    );

    return {
      fileType: RagFileType.DOCX,
      content,
      metadata: {
        parser: 'docx',
      },
    };
  }

  private convertCellValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value).trim();
  }

  private parseXlsx(file: Express.Multer.File): ParsedRagFile {
    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      cellDates: true,
    });

    const segments: ParsedRagSegment[] = [];
    const sheetNames: string[] = [];
    let totalRows = 0;
    const maxRowsPerSheet = 500;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        continue;
      }

      const rawRows = XLSX.utils.sheet_to_json<
        (string | number | boolean | Date | null)[]
      >(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
      });

      const rows = rawRows
        .map((row) => row.map((cell) => this.convertCellValue(cell)))
        .filter((row) => row.some((cell) => cell.length > 0))
        .slice(0, maxRowsPerSheet);

      if (rows.length === 0) {
        continue;
      }

      sheetNames.push(sheetName);
      const hasHeaderRow = this.detectHeaderRow(rows);
      const headerRow = hasHeaderRow
        ? rows[0]
        : rows[0].map((_, columnIndex) => `Cot ${columnIndex + 1}`);
      const dataRows = hasHeaderRow ? rows.slice(1) : rows;

      dataRows.forEach((row, index) => {
        const pairs = row
          .map((value, columnIndex) => {
            const key = headerRow[columnIndex] || `Cot ${columnIndex + 1}`;
            if (!value) {
              return null;
            }

            return `* ${key}: ${value}`;
          })
          .filter((item): item is string => Boolean(item));

        if (pairs.length === 0) {
          return;
        }

        totalRows += 1;
        const rowIndex = index + (hasHeaderRow ? 2 : 1);
        segments.push({
          title: `Sheet: ${sheetName} - Dong ${rowIndex}`,
          section: `Sheet: ${sheetName}`,
          content: `Sheet: ${sheetName}\nDong ${rowIndex}:\n${pairs.join('\n')}`,
          metadata: {
            parser: 'xlsx',
            sheetName,
            headers: headerRow,
            rowIndex,
            rowRange: `${rowIndex}-${rowIndex}`,
          },
        });
      });
    }

    if (segments.length === 0) {
      throw new BadRequestException(
        'File XLSX khong co du lieu text hop le.',
      );
    }

    return {
      fileType: RagFileType.XLSX,
      content: segments.map((segment) => segment.content).join('\n\n'),
      metadata: {
        parser: 'xlsx',
        sheetNames,
        rowCount: totalRows,
      },
      segments,
    };
  }

  private async parsePdf(file: Express.Multer.File): Promise<ParsedRagFile> {
    const parser = new PDFParse({ data: file.buffer });
    const result = await parser.getText();
    const content = this.ensureText(
      result.text.replace(/\r\n/g, '\n'),
      'PDF nay khong co lop text hoac can OCR, hien he thong chua ho tro OCR.',
    );
    this.logger.log(
      `Parsed PDF text for ${file.originalname} with ${result.total} page(s)`,
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
