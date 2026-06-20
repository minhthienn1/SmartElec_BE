export const RAG_LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_PARSED_TEXT_CHARS: 500_000,
  MAX_CHUNKS_PER_DOCUMENT: 300,
  MIN_CHUNK_CHARS: 80,
  EMBEDDING_BATCH_CONCURRENCY: 3,
  DEFAULT_RETRIEVAL_LIMIT: 5,
  MIN_RETRIEVAL_SCORE: 0.2,
  DOCUMENT_CONTENT_PREVIEW_CHARS: 240,
} as const;

export const ALLOWED_RAG_IMPORT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.docx',
  '.xlsx',
  '.pdf',
]);

export const ALLOWED_RAG_IMPORT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/octet-stream',
]);

export const RAG_IMPORT_UNSUPPORTED_FILE_MESSAGE =
  'Chi ho tro file TXT, MD, CSV, DOCX, XLSX hoac PDF co text.';
