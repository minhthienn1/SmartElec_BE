export const RAG_LIMITS = {
  // Upload/file limits
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  MAX_FILENAME_CHARS: 255,

  // Parsed text limits
  MAX_PARSED_TEXT_CHARS: 500_000,
  MAX_DESCRIPTION_CHARS: 2_000,

  // Chunking limits
  MAX_CHUNKS_PER_DOCUMENT: 300,
  MIN_CHUNK_CHARS: 180,
  DEFAULT_CHUNK_MAX_CHARS: 1_800,
  DEFAULT_CHUNK_OVERLAP_CHARS: 160,

  // Metadata limits
  MAX_TAGS: 20,
  MAX_TAG_LENGTH: 50,
  MAX_TEXT_FIELD_CHARS: 200,

  // Spreadsheet parser limits
  MAX_WORKBOOK_SHEETS: 20,
  MAX_WORKBOOK_ROWS: 5_000,

  // Gemini Embedding throttle/retry
  EMBEDDING_BATCH_CONCURRENCY: 1,
  EMBEDDING_MIN_INTERVAL_MS: 2_500,
  EMBEDDING_RETRY_DELAYS_MS: [5_000, 10_000, 20_000],

  // Retrieval
  DEFAULT_RETRIEVAL_LIMIT: 5,
  MIN_RETRIEVAL_SCORE: 0.2,

  // UI/API preview
  DOCUMENT_CONTENT_PREVIEW_CHARS: 240,
} as const;

export const ALLOWED_RAG_IMPORT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.docx',
  '.xlsx',
  '.pdf',
]);

export const ALLOWED_RAG_IMPORT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',

  /*
    Một số browser/Windows upload file với MIME application/octet-stream.
    Chỉ nên cho phép MIME này nếu code validate thêm extension và signature.
  */
  'application/octet-stream',
]);

export const RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE =
  'Chỉ hỗ trợ file TXT, MD, CSV, DOCX, XLSX hoặc PDF có lớp text.';
