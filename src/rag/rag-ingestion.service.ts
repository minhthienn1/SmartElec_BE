import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AccessLevel,
  Prisma,
  RagDocumentKind,
  RagDocumentStatus,
  RagFileType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { extname } from 'path';

import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { mapWithConcurrency } from './rag-batch.util';
import { RAG_LIMITS } from './rag.constants';
import { ImportRagFileDto } from './dto/import-rag-file.dto';
import { RagChunkingService } from './rag-chunking.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { buildChunkEmbeddingText } from './rag-embedding-text.util';
import { RagFileParserService } from './rag-file-parser.service';
import { hasInvalidRagFilename, normalizeRagFilename } from './rag-filename.util';
import { RagTextCleanerService } from './rag-text-cleaner.service';


type ImportedDocumentResult = {
  id: number;
  title: string;
  description: string | null;
  content: string;
  category: string | null;
  brand: string | null;
  modelCode: string | null;
  source: string | null;
  accessLevel: string;
  fileType: RagFileType;
  originalFileName: string | null;
  createdAt: Date;
  updatedAt: Date;
  indexedAt: Date | null;
  status: RagDocumentStatus;
  totalChunks: number;
  totalCharacters: number;
};

type ParsedSegment = {
  title?: string;
  section?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
};

type ChunkDraft = {
  title: string;
  section: string | null;
  content: string;
  charCount: number;
  metadata?: Record<string, unknown>;
};

type ChunkPayload = ChunkDraft & {
  chunkIndex: number;
  tokenCount: number;
  embedding: string;
};

type PrismaRawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

type SuggestedImportMetadata = {
  title: string;
  description: string | null;
  kind: RagDocumentKind | null;
  category: string | null;
  brand: string | null;
  modelCode: string | null;
  source: string | null;
  tags: string[];
};

@Injectable()
export class RagIngestionService {
  private readonly logger = new Logger(RagIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly ragFileParserService: RagFileParserService,
    private readonly ragTextCleanerService: RagTextCleanerService,
    private readonly ragChunkingService: RagChunkingService,
    private readonly ragEmbeddingService: RagEmbeddingService,
    @InjectQueue('rag-import-queue')
    private readonly ragImportQueue: Queue,
  ) { }

  //đặt tiêu đề cho từng chunk
  private buildChunkTitle(
    baseTitle: string,
    chunkIndex: number,
    totalChunks: number,
  ) {
    if (totalChunks <= 1) {
      return baseTitle;
    }

    return `${baseTitle} - Phần ${chunkIndex + 1}`;
  }

  //tính ước lượng số token của một đoạn text
  private estimateTokenCount(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
  }

  private normalizeTags(tags?: string[] | string | null): string[] {
    if (!tags) {
      return [];
    }

    const normalized = Array.isArray(tags)
      ? tags
        .map((tag) => String(tag).trim())
        .filter((tag) => tag.length > 0)
      : String(tags)
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

    return [...new Set(normalized)];
  }

  //biến tên file thành một tiêu đề dễ đọc hơn
  // raw: huong_dan-sua_may_lanh.pdf
  //result: huong dan sua may lanh
  private prettifyFileTitle(fileName: string) {
    return fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeTextForSuggestion(text: string) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private includesAnyPhrase(text: string, phrases: string[]) {
    return phrases.some((phrase) => text.includes(phrase));
  }

  //đoán danh mục thiết bị từ một đoạn text đã được chuẩn hóa
  private inferSuggestedCategory(normalizedText: string): string | null {
    const categoryMap: Array<[string[], string]> = [
      [['may lanh', 'dieu hoa', 'dieu hoa khong khi'], 'Máy lạnh'],
      [['may giat'], 'Máy giặt'],
      [['tu lanh'], 'Tủ lạnh'],
      [['binh nong lanh', 'may nuoc nong', 'binh nuoc nong'], 'Máy nước nóng'],
      [['lo vi song'], 'Lò vi sóng'],
      [['lo nuong'], 'Lò nướng'],
      [['may hut mui'], 'Máy hút mùi'],
      [['may bom'], 'Máy bơm'],
      [['o dien', 'cong tac', 'aptomat', 'cau dao'], 'Thiết bị điện'],
    ];

    for (const [keywords, label] of categoryMap) {
      if (this.includesAnyPhrase(normalizedText, keywords)) {
        return label;
      }
    }

    return null;
  }

  //đoán hãng thiết bị
  private inferSuggestedBrand(normalizedText: string): string | null {
    const brandMap: Array<[string, string]> = [
      ['daikin', 'Daikin'],
      ['panasonic', 'Panasonic'],
      ['toshiba', 'Toshiba'],
      ['lg', 'LG'],
      ['samsung', 'Samsung'],
      ['electrolux', 'Electrolux'],
      ['sharp', 'Sharp'],
      ['aqua', 'Aqua'],
      ['hitachi', 'Hitachi'],
      ['mitsubishi', 'Mitsubishi'],
      ['casper', 'Casper'],
      ['gree', 'Gree'],
      ['funiki', 'Funiki'],
      ['ariston', 'Ariston'],
    ];

    for (const [keyword, label] of brandMap) {
      if (new RegExp(`\\b${keyword}\\b`, 'i').test(normalizedText)) {
        return label;
      }
    }

    return null;
  }

  //đoán mã code
  private inferSuggestedModelCode(rawText: string): string | null {
    const matches = rawText.match(/\b[A-Z0-9-]{4,20}\b/g) ?? [];
    const candidates = matches.filter((candidate) => {
      const value = candidate.toUpperCase();
      if (!/[A-Z]/.test(value) || !/\d/.test(value)) {
        return false;
      }

      return ![
        'DOCX',
        'XLSX',
        'PDF',
        'JSON',
        'HTML',
        'RAG',
        'FAQ',
      ].includes(value);
    });

    return candidates[0] ?? null;
  }

  //dự đoán loại tài liệu RAG cần được sử dụng
  private inferSuggestedKind(
    normalizedText: string,
    originalFileName: string,
  ): RagDocumentKind | null {
    const combinedText = `${normalizedText} ${this.normalizeTextForSuggestion(originalFileName)}`;

    if (this.includesAnyPhrase(combinedText, ['faq', 'cau hoi thuong gap'])) {
      return RagDocumentKind.FAQ;
    }

    if (
      this.includesAnyPhrase(combinedText, [
        'bang gia',
        'bao gia',
        'gia dich vu',
        'don gia',
      ])
    ) {
      return RagDocumentKind.PRICE_TABLE;
    }

    if (
      this.includesAnyPhrase(combinedText, [
        'manual',
        'huong dan su dung',
        'so tay',
        'user guide',
      ])
    ) {
      return RagDocumentKind.DEVICE_MANUAL;
    }

    if (
      this.includesAnyPhrase(combinedText, [
        'chinh sach',
        'quy dinh',
        'bao hanh',
        'quy trinh',
      ])
    ) {
      return RagDocumentKind.REPAIR_POLICY;
    }

    if (
      this.includesAnyPhrase(combinedText, [
        'ghi chu noi bo',
        'internal note',
        'noi bo',
      ])
    ) {
      return RagDocumentKind.INTERNAL_NOTE;
    }

    if (
      this.includesAnyPhrase(combinedText, [
        'ma loi',
        'loi',
        'khong mat',
        'khong lanh',
        'khong chay',
        'khong len nguon',
        'chay nuoc',
        'keu to',
      ])
    ) {
      return RagDocumentKind.TROUBLESHOOTING_GUIDE;
    }

    return null;
  }

  private buildSuggestedDescription(cleanedText: string, title: string) {
    const lines = cleanedText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const candidate = lines.find(
      (line) => line !== title && line.length >= 32 && line.length <= 220,
    );

    return candidate ? candidate.slice(0, RAG_LIMITS.MAX_DESCRIPTION_CHARS) : null;
  }

  private buildSuggestedTags(params: {
    normalizedText: string;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
    kind: RagDocumentKind | null;
  }) {
    const { normalizedText, category, brand, modelCode, kind } = params;
    const tags = new Set<string>();

    if (category) tags.add(category);
    if (brand) tags.add(brand);
    if (modelCode) tags.add(modelCode);

    const keywordTags: Array<[string[], string]> = [
      [['inverter'], 'inverter'],
      [['bao tri', 've sinh'], 'bảo trì'],
      [['ma loi', 'error'], 'mã lỗi'],
      [['an toan', 'ro dien', 'chap dien', 'boc khoi'], 'an toàn điện'],
      [['khong mat', 'khong lanh'], 'không mát'],
      [['khong vat'], 'không vắt'],
      [['khong xa'], 'không xả nước'],
      [['chay nuoc', 'ri nuoc'], 'chảy nước'],
      [['bang gia', 'bao gia'], 'bảng giá'],
    ];

    for (const [phrases, label] of keywordTags) {
      if (this.includesAnyPhrase(normalizedText, phrases)) {
        tags.add(label);
      }
    }

    if (kind === RagDocumentKind.DEVICE_MANUAL) {
      tags.add('hướng dẫn sử dụng');
    }

    return Array.from(tags).slice(0, RAG_LIMITS.MAX_TAGS);
  }

  private buildSuggestedMetadata(params: {
    originalFileName: string;
    cleanedText: string;
  }): SuggestedImportMetadata {
    const { originalFileName, cleanedText } = params;
    const fallbackTitle = this.prettifyFileTitle(originalFileName);
    const normalizedText = this.normalizeTextForSuggestion(
      `${fallbackTitle}\n${cleanedText.slice(0, 20_000)}`,
    );
    const category = this.inferSuggestedCategory(normalizedText);
    const brand = this.inferSuggestedBrand(normalizedText);
    const modelCode = this.inferSuggestedModelCode(
      `${originalFileName}\n${cleanedText.slice(0, 10_000)}`,
    );
    const kind = this.inferSuggestedKind(normalizedText, originalFileName);
    const title = fallbackTitle;
    const description = this.buildSuggestedDescription(cleanedText, title);
    const source = fallbackTitle || null;
    const tags = this.buildSuggestedTags({
      normalizedText,
      category,
      brand,
      modelCode,
      kind,
    });

    return {
      title,
      description,
      kind,
      category,
      brand,
      modelCode,
      source,
      tags,
    };
  }

  private async updateChunkEmbedding(
    client: PrismaRawExecutor,
    chunkId: number,
    embedding: string,
  ) {
    await client.$executeRaw`
      UPDATE "rag_chunks"
      SET "embedding" = CAST(${embedding} AS vector), "updatedAt" = now()
      WHERE "id" = ${chunkId}
    `;
  }

  private mapImportedDocument(document: {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
    source: string | null;
    accessLevel: string;
    fileType: RagFileType;
    originalFileName: string | null;
    createdAt: Date;
    updatedAt: Date;
    indexedAt: Date | null;
    status: RagDocumentStatus;
    totalChunks: number;
    totalCharacters: number;
    chunks: Array<{ content: string }>;
  }): ImportedDocumentResult {
    return {
      id: document.id,
      title: document.title,
      description: document.description,
      content: document.chunks[0]?.content || '',
      category: document.category,
      brand: document.brand,
      modelCode: document.modelCode,
      source: document.source,
      accessLevel: document.accessLevel,
      fileType: document.fileType,
      originalFileName: document.originalFileName,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      indexedAt: document.indexedAt,
      status: document.status,
      totalChunks: document.totalChunks,
      totalCharacters: document.totalCharacters,
    };
  }

  private getErrorMessage(error: unknown) {
    const response =
      error instanceof HttpException ? error.getResponse() : null;

    if (typeof response === 'string') {
      return response;
    }

    if (response && typeof response === 'object' && 'message' in response) {
      const message = response.message;

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Không thể import tài liệu RAG từ file.';
  }

  private async cleanupChunks(documentId: number) {
    await this.prisma.ragChunk.deleteMany({
      where: { documentId },
    });
  }

  private async markFailed(documentId: number, error: unknown) {
    await this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.FAILED,
        errorMessage: this.getErrorMessage(error),
        totalChunks: 0,
        totalTokens: 0,
        indexedAt: null,
      },
    });
  }

  private async cleanupFailedImport(documentId: number, error: unknown) {
    try {
      await this.cleanupChunks(documentId);
      await this.markFailed(documentId, error);
    } catch (cleanupError) {
      this.logger.error(
        `Không thể cleanup tài liệu RAG lỗi documentId=${documentId}`,
        cleanupError,
      );
    }
  }

  //lấy thông tin tài liệu từ DB theo documentId
  private async loadImportedDocument(documentId: number) {
    return this.prisma.ragDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        description: true,
        originalFileName: true,
        storedFileName: true,
        fileUrl: true,
        mimeType: true,
        fileType: true,
        checksum: true,
        kind: true,
        category: true,
        brand: true,
        modelCode: true,
        source: true,
        tags: true,
        accessLevel: true,
        status: true,
        errorMessage: true,
        uploadedById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  //tải file gốc từ URL về backend và chuyển nội dung file thành Buffer để parser có thể đọc
  private async loadImportedFileBuffer(fileUrl: string) {
    if (!fileUrl) {
      throw new BadRequestException(
        'Không tìm thấy đường dẫn file gốc để xử lý nền.',
      );
    }

    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new BadRequestException(
        `Không thể tải file gốc để xử lý nền (${response.status}).`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private toSyntheticUploadFile(params: {
    originalFileName: string | null;
    storedFileName: string | null;
    mimeType: string | null;
    buffer: Buffer;
  }): Express.Multer.File {
    const { originalFileName, storedFileName, mimeType, buffer } = params;

    return {
      originalname: originalFileName || storedFileName || 'rag-import-file',
      mimetype: mimeType || 'application/octet-stream',
      buffer,
      size: buffer.length,
    } as Express.Multer.File;
  }

  //đưa tài liệu vào hàng đợi để xử lý nền 
  private async scheduleImportedDocumentProcessing(documentId: number) {
    try {
      //gửi công việc đi
      await this.ragImportQueue.add(
        'process-imported-document',
        { documentId },
        {
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.error(
        `Không thể đẩy job import RAG vào queue documentId=${documentId}. Chuyển sang xử lý nền trong process hiện tại.`,
        error,
      );

      setImmediate(() => {
        void this.processImportedDocument(documentId).catch((jobError) => {
          this.logger.error(
            `Lỗi fallback xử lý nền documentId=${documentId}`,
            jobError,
          );
        });
      });
    }
  }

  //xử lý một tài liệu RAG sau khi đã được worker lấy ra khỏi queue
  async processImportedDocument(documentId: number) {
    const document = await this.loadImportedDocument(documentId);

    if (!document) {
      this.logger.warn(`Không tìm thấy documentId=${documentId} để xử lý nền.`);
      return;
    }

    if (document.status !== RagDocumentStatus.UPLOADED) {
      this.logger.warn(
        `Bỏ qua documentId=${documentId} vì status hiện tại là ${document.status}.`,
      );
      return;
    }

    //fall back: originalFileName -> storedFileName -> title
    const originalFileName =
      document.originalFileName || document.storedFileName || document.title;
    const importStartedAt = Date.now();

    try {
      let stageStartedAt = importStartedAt;

      this.logger.log(
        `RAG bắt đầu phân tích tài liệu documentId=${documentId}, tên file gốc=${originalFileName}`,
      );

      //Nếu document vẫn đang UPLOADED -> đổi sang PARSING
      const started = await this.prisma.ragDocument.updateMany({
        where: {
          id: documentId,
          status: RagDocumentStatus.UPLOADED,
        },
        data: {
          status: RagDocumentStatus.PARSING,
          errorMessage: null,
        },
      });

      if (started.count === 0) {
        this.logger.warn(
          `Bỏ qua documentId=${documentId} vì job khác đã bắt đầu xử lý.`,
        );
        return;
      }
      this.logger.log(
        `RAG chuyển trạng thái documentId=${documentId} từ UPLOADED sang PARSING`,
      );

      //đọc file lưu trữ -> chuyển sang dữ liệu có thể xử lý
      const fileBuffer = await this.loadImportedFileBuffer(
        document.fileUrl || '',
      );

      const syntheticFile = this.toSyntheticUploadFile({
        originalFileName,
        storedFileName: document.storedFileName,
        mimeType: document.mimeType,
        buffer: fileBuffer,
      });

      //biến syntheticFile thành dạng có thể parse được và clean nội dung
      const parsed = await this.ragFileParserService.parse(syntheticFile);
      const cleanedText = this.ragTextCleanerService.clean(parsed.content);
      this.ragTextCleanerService.assertEncodingQuality(cleanedText);

      //kiểm tra file text có rỗng ( trường hợp file rỗng trước và sau khi clean)
      if (!cleanedText.trim()) {
        const isPdfFile =
          document.fileType === RagFileType.PDF ||
          document.mimeType?.toLowerCase().includes('pdf') ||
          document.originalFileName?.toLowerCase().endsWith('.pdf');

        throw new BadRequestException(
          isPdfFile
            ? 'PDF này là file scan/ảnh, hệ thống chưa hỗ trợ OCR. Vui lòng upload PDF có thể copy chữ, DOCX hoặc TXT.'
            : 'File không có nội dung hợp lệ sau khi làm sạch.',
        );
      }

      if (cleanedText.length < RAG_LIMITS.MIN_CHUNK_CHARS) {
        throw new BadRequestException(
          'Nội dung tài liệu quá ngắn sau khi parse, không đủ để tạo chunk có nghĩa.',
        );
      }

      if (cleanedText.length > RAG_LIMITS.MAX_PARSED_TEXT_CHARS) {
        throw new BadRequestException(
          'Tài liệu quá lớn sau khi parse, vui lòng chia nhỏ file theo chương hoặc chủ đề.',
        );
      }
      this.logger.log(
        `RAG hoàn tất giai đoạn PARSING documentId=${documentId}, thời gian=${Date.now() - stageStartedAt}ms`,
      );
      stageStartedAt = Date.now();

      //giai đoạn tách file thành chunks -> update status thành CHUNKING
      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.CHUNKING,
          totalCharacters: cleanedText.length,
          parsedAt: new Date(),
          errorMessage: null,
        },
      });
      this.logger.log(
        `RAG chuyển trạng thái documentId=${documentId} từ PARSING sang CHUNKING`,
      );

      //hàm buildSegments() có nhiệm vụ chia tài liệu thành nhiều phần nhỏ.
      const chunkDrafts = this.buildSegments(
        document.title,
        cleanedText,
        parsed.metadata,
        parsed.segments,
      );

      this.logger.log(
        `RAG đã chia tài liệu documentId=${documentId} thành ${chunkDrafts.length} chunk`,
      );

      if (chunkDrafts.length === 0) {
        throw new BadRequestException('Không thể tách nội dung thành chunk.');
      }

      if (chunkDrafts.length > RAG_LIMITS.MAX_CHUNKS_PER_DOCUMENT) {
        throw new BadRequestException(
          'Tài liệu tạo ra quá nhiều chunk, vui lòng chia nhỏ file.',
        );
      }
      this.logger.log(
        `RAG hoàn tất giai đoạn CHUNKING documentId=${documentId}, thời gian=${Date.now() - stageStartedAt}ms`,
      );
      stageStartedAt = Date.now();

      //chuyển đổi trạng thái các chunk sang EMBEDDING để chuẩn bị tạo embedding vector
      await this.prisma.ragDocument.update({
        where: { id: documentId },
        data: {
          status: RagDocumentStatus.EMBEDDING,
        },
      });
      this.logger.log(
        `RAG chuyển trạng thái documentId=${documentId} từ CHUNKING sang EMBEDDING`,
      );

      //biến các chunk thành dữ liệu hoàn chỉnh để lưu vào db
      const chunkPayloads = await this.buildChunkPayloads(
        documentId,
        chunkDrafts,
        {
          baseTitle: document.title,
          category: document.category,
          brand: document.brand,
          modelCode: document.modelCode,
          source: document.source,
          accessLevel: document.accessLevel,
        },
      );

      const totalTokens = chunkPayloads.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      );

      //Lưu chunks và đánh dấu document là READY
      await this.saveChunksAndMarkReady({
        documentId,
        chunkPayloads,
        cleanedText,
        totalTokens,
        category: document.category,
        brand: document.brand,
        modelCode: document.modelCode,
        tags: document.tags,
        accessLevel: document.accessLevel,
        originalFileName,
      });

      this.logger.log(
        `RAG chuyển trạng thái documentId=${documentId} từ EMBEDDING sang READY`,
      );
      this.logger.log(
        `RAG hoàn tất giai đoạn EMBEDDING documentId=${documentId}, thời gian=${Date.now() - stageStartedAt}ms`,
      );
      this.logger.log(
        `RAG hoàn tất import documentId=${documentId}, tổng thời gian=${Date.now() - importStartedAt}ms`,
      );
    } catch (error) {
      await this.cleanupFailedImport(documentId, error);

      const reason = error instanceof Error ? error.message : 'Không xác định';
      this.logger.error(
        `RAG chuyển trạng thái documentId=${documentId} sang FAILED, tổng thời gian=${Date.now() - importStartedAt}ms, lý do=${reason}`,
        error,
      );
    }
  }

  private buildSegments(
    baseTitle: string,
    content: string,
    parserMetadata?: Record<string, unknown>,
    parsedSegments?: ParsedSegment[],
  ): ChunkDraft[] {

    // Giữ cả fragment ngắn sau dedupe để không làm mất unique knowledge.
    const normalizedSegments = (segments: ChunkDraft[]) =>
      segments.filter((segment) => segment.content.trim().length > 0);

    const dedupeContext = this.ragChunkingService.createDocumentDedupeContext();

    if (parsedSegments && parsedSegments.length > 0) {
      return normalizedSegments(
        //duyệt seq -> đem đi chia thành chunk
        parsedSegments.flatMap((segment, segmentIndex) => {
          const dedupedSegment = this.ragChunkingService.dedupeSourceText(
            segment.content,
            dedupeContext,
          );

          this.logger.log(
            `RAG lọc trùng đoạn segmentIndex=${segmentIndex}, độ dài ban đầu=${dedupedSegment.rawLength}, độ dài sau lọc=${dedupedSegment.dedupedLength}, số vùng trùng đã bỏ=${dedupedSegment.removedDuplicateRanges}`,
          );

          const chunkedSegments = this.ragChunkingService.chunk({
            content: dedupedSegment.content,
            maxChars: RAG_LIMITS.DEFAULT_CHUNK_MAX_CHARS,
            overlapChars: RAG_LIMITS.DEFAULT_CHUNK_OVERLAP_CHARS,
            dedupeContext,
            skipSourceDedupe: true,
          });

          //Duyệt từng chunk và tạo ra một object mới.
          return chunkedSegments.map((chunk) => ({
            title:
              segment.title ||
              this.buildChunkTitle(
                baseTitle,
                segmentIndex,
                parsedSegments.length,
              ),
            section: segment.section ?? null,
            content: chunk.content,
            charCount: chunk.charCount,
            metadata: segment.metadata ?? parserMetadata,
          }));
        }),
      );
    }

    const dedupedContent = this.ragChunkingService.dedupeSourceText(
      content,
      dedupeContext,
    );

    this.logger.log(
      `RAG lọc trùng tài liệu, độ dài ban đầu=${dedupedContent.rawLength}, độ dài sau lọc=${dedupedContent.dedupedLength}, số vùng trùng đã bỏ=${dedupedContent.removedDuplicateRanges}`,
    );

    const chunkedSegments = this.ragChunkingService.chunk({
      content: dedupedContent.content,
      maxChars: RAG_LIMITS.DEFAULT_CHUNK_MAX_CHARS,
      overlapChars: RAG_LIMITS.DEFAULT_CHUNK_OVERLAP_CHARS,
      dedupeContext,
      skipSourceDedupe: true,
    });

    return normalizedSegments(
      chunkedSegments.map((chunk) => ({
        title: this.buildChunkTitle(
          baseTitle,
          chunk.chunkIndex,
          chunkedSegments.length,
        ),
        section: null,
        content: chunk.content,
        charCount: chunk.charCount,
        metadata: parserMetadata,
      })),
    );
  }

  //chặn việc upload trùng lặp file đã tồn tại trong RAG
  private async ensureNoExistingDuplicate(checksum: string) {
    const existing = await this.prisma.ragDocument.findFirst({
      where: {
        checksum,
        status: {
          not: RagDocumentStatus.FAILED,
        },
      },
      select: {
        id: true,
        status: true,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      throw new ConflictException({
        message: 'File này đã từng được import vào kho tri thức RAG.',
        existingDocumentId: existing.id,
        existingStatus: existing.status,
        existingIsActive: existing.isActive,
      });
    }
  }

  private async buildChunkPayloads(
    documentId: number,
    chunks: ChunkDraft[],
    context: {
      baseTitle: string;
      category: string | null;
      brand: string | null;
      modelCode: string | null;
      source: string | null;
      accessLevel: AccessLevel;
    },
  ): Promise<ChunkPayload[]> {
    //duyệt qua tất cả các chunk nhưng giới hạn xử lý tránh quá tải
    return mapWithConcurrency(
      chunks,
      RAG_LIMITS.EMBEDDING_BATCH_CONCURRENCY,

      //Mỗi lần callback nhận chunk và index
      async (chunk, index) => {
        try {
          //tính token xử lý
          const tokenCount = this.estimateTokenCount(chunk.content);

          this.logger.log(
            `RAG đang tạo embedding documentId=${documentId}, chunkIndex=${index}`,
          );

          //tạo embedding và Biến text thành vector embedding
          //text -. gemini -> embedding vector
          const embeddingValues =
            await this.ragEmbeddingService.generateEmbedding(
              //bổ sung ngữ cảnh
              buildChunkEmbeddingText({
                documentTitle: context.baseTitle,
                category: context.category,
                brand: context.brand,
                modelCode: context.modelCode,
                source: context.source,
                accessLevel: context.accessLevel,
                chunkTitle: chunk.title,
                section: chunk.section,
                metadata: chunk.metadata,
                content: chunk.content,
              }),
            );

          return {
            chunkIndex: index,
            title: chunk.title,
            section: chunk.section,
            content: chunk.content,
            charCount: chunk.charCount,
            tokenCount,
            metadata: chunk.metadata,
            embedding: this.ragEmbeddingService.toPgVector(embeddingValues),
          };
        } catch (error) {
          this.logger.error(
            `Lỗi embedding chunk documentId=${documentId} chunkIndex=${index}`,
            error,
          );

          if (error instanceof HttpException) {
            throw error;
          }

          throw new BadRequestException(
            `Không thể tạo embedding cho chunk ${index + 1} của tài liệu.`,
          );
        }
      },
    );
  }

  private async saveChunksAndMarkReady(params: {
    documentId: number;
    chunkPayloads: ChunkPayload[];
    cleanedText: string;
    totalTokens: number;
    category: string | null;
    brand: string | null;
    modelCode: string | null;
    tags: string[];
    accessLevel: AccessLevel;
    originalFileName: string;
  }) {
    const {
      documentId,
      chunkPayloads,
      cleanedText,
      totalTokens,
      category,
      brand,
      modelCode,
      tags,
      accessLevel,
      originalFileName,
    } = params;

    /*
      Không dùng this.prisma.$transaction lớn ở đây.

      Lý do:
      - File dài có thể tạo nhiều chunk.
      - Mỗi chunk cần create + update vector bằng raw SQL.
      - Interactive transaction mặc định của Prisma timeout 5000ms.
      - Nếu fail giữa chừng, catch ngoài sẽ xóa chunks dở và mark document FAILED.
    */
    for (const chunk of chunkPayloads) {
      const createdChunk = await this.prisma.ragChunk.create({
        data: {
          documentId,
          chunkIndex: chunk.chunkIndex,
          title: chunk.title,
          section: chunk.section,
          content: chunk.content,
          category,
          brand,
          modelCode,
          tags,
          accessLevel,
          charCount: chunk.charCount,
          tokenCount: chunk.tokenCount,
          metadata: chunk.metadata
            ? {
              ...chunk.metadata,
              originalFileName,
            }
            : {
              originalFileName,
            },
        },
      });

      await this.updateChunkEmbedding(
        this.prisma,
        createdChunk.id,
        chunk.embedding,
      );
    }

    return this.prisma.ragDocument.update({
      where: { id: documentId },
      data: {
        status: RagDocumentStatus.READY,
        totalChunks: chunkPayloads.length,
        totalCharacters: cleanedText.length,
        totalTokens,
        indexedAt: new Date(),
        parsedAt: new Date(),
        errorMessage: null,
      },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });
  }
  private async validateFileBeforeStorage(
    file: Express.Multer.File,
    _fileType: RagFileType,
  ): Promise<void> {
    this.ragFileParserService.validateInput(file);
  }

  async suggestImportMetadata(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file để đọc gợi ý.');
    }

    if (file.size <= 0) {
      throw new BadRequestException('File import đang rỗng.');
    }

    const originalFileName = normalizeRagFilename(file.originalname);

    if (!originalFileName.trim()) {
      throw new BadRequestException('Tên file import không hợp lệ.');
    }

    if (originalFileName.length > RAG_LIMITS.MAX_FILENAME_CHARS) {
      throw new BadRequestException(
        `Tên file quá dài. Tối đa cho phép: ${RAG_LIMITS.MAX_FILENAME_CHARS} ký tự.`,
      );
    }

    if (hasInvalidRagFilename(originalFileName)) {
      throw new BadRequestException(
        'Tên file chứa ký tự điều khiển không hợp lệ.',
      );
    }

    file.originalname = originalFileName;

    const fileType = this.ragFileParserService.inferFileType(file);
    await this.validateFileBeforeStorage(file, fileType);

    const parsed = await this.ragFileParserService.parse(file);
    const cleanedText = this.ragTextCleanerService.clean(parsed.content);
    this.ragTextCleanerService.assertEncodingQuality(cleanedText);

    if (!cleanedText.trim()) {
      throw new BadRequestException(
        'Không đọc được nội dung hợp lệ từ file để gợi ý thông tin.',
      );
    }

    return {
      message: 'Đã đọc file và tạo gợi ý thông tin tự động.',
      metadata: this.buildSuggestedMetadata({
        originalFileName,
        cleanedText,
      }),
    };
  }

  //kiểm tra file trước khi import
  async importFile(
    file: Express.Multer.File,
    dto: ImportRagFileDto,
    uploadedById?: number,
  ) {
    if (!file) {
      throw new BadRequestException('Không tìm thấy file để import.');
    }

    if (file.size <= 0) {
      throw new BadRequestException('File import đang rỗng.');
    }

    const originalFileName = normalizeRagFilename(file.originalname);

    if (!originalFileName.trim()) {
      throw new BadRequestException('Tên file import không hợp lệ.');
    }

    if (originalFileName.length > RAG_LIMITS.MAX_FILENAME_CHARS) {
      throw new BadRequestException(
        `Tên file quá dài. Tối đa cho phép: ${RAG_LIMITS.MAX_FILENAME_CHARS} ký tự.`,
      );
    }

    if (hasInvalidRagFilename(originalFileName)) {
      throw new BadRequestException(
        'Tên file chứa ký tự điều khiển không hợp lệ.',
      );
    }

    // Gán lại để upload/parser/log phía sau đều dùng tên file đã sửa mojibake.
    file.originalname = originalFileName;

    const checksum = createHash('sha256')
      .update(file.buffer)
      .digest('hex'); //trả kết quả dưới dạng chuỗi ký tự hexadecimal

    //kiểm tra kiểu file
    const fileType = this.ragFileParserService.inferFileType(file);

    await this.ensureNoExistingDuplicate(checksum);

    // Chặn PDF scan/ảnh trước khi upload R2 và trước khi tạo RagDocument.
    await this.validateFileBeforeStorage(file, fileType);

    const storedFileName = `${Date.now()}-${checksum.slice(0, 12)}${extname(
      originalFileName,
    ).toLowerCase()}`;

    const baseTitle =
      dto.title?.trim() || originalFileName.replace(/\.[^.]+$/, '');
    const accessLevel = dto.accessLevel ?? AccessLevel.ADVANCED;
    const category = dto.category?.trim() || null;
    const brand = dto.brand?.trim() || null;
    const modelCode = dto.modelCode?.trim() || null;
    const source = dto.source?.trim() || null;
    const tags = this.normalizeTags(dto.tags);

    try {
      const uploadResult = await this.uploadService.uploadFileWithMetadata(
        file,
        'rag-knowledge',
        storedFileName,
      );

      const createdDocument = await this.prisma.ragDocument.create({
        data: {
          title: baseTitle,
          description: dto.description?.trim() || null,
          originalFileName,
          storedFileName: uploadResult.storedFileName,
          fileUrl: uploadResult.url,
          storageKey: uploadResult.storageKey,
          mimeType: file.mimetype,
          fileType,
          fileSizeBytes: BigInt(file.size),
          checksum,
          kind: dto.kind ?? null,
          category,
          brand,
          modelCode,
          source,
          tags,
          accessLevel,
          status: RagDocumentStatus.UPLOADED,
          uploadedById: uploadedById ?? null,
        },
      });

      this.logger.log(
        `RAG chuyển trạng thái documentId=${createdDocument.id} sang UPLOADED`,
      );
      await this.scheduleImportedDocumentProcessing(createdDocument.id);

      return {
        message: 'Tài liệu đã được nhận và đang được xử lý.',
        document: this.mapImportedDocument({
          ...createdDocument,
          chunks: [],
        }),
      };
    } catch (error) {
      this.logger.error(
        `Lỗi khi import tài liệu RAG từ file ${originalFileName}`,
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Không thể import tài liệu RAG từ file.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
