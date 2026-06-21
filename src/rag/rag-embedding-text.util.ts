type BuildChunkEmbeddingTextParams = {
  documentTitle: string;
  category?: string | null;
  brand?: string | null;
  modelCode?: string | null;
  source?: string | null;
  accessLevel?: string | null;
  chunkTitle?: string | null;
  section?: string | null;
  metadata?: unknown;
  content: string;
};

function getMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return metadata as Record<string, unknown>;
}

function extractHeadingPath(metadata: unknown): string | null {
  const record = getMetadataRecord(metadata);

  if (!record) {
    return null;
  }

  const headingPath = record.headingPath;

  if (Array.isArray(headingPath)) {
    const parts = headingPath
      .map((item) => String(item).trim())
      .filter(Boolean);

    return parts.length > 0 ? parts.join(' > ') : null;
  }

  if (typeof headingPath === 'string') {
    const trimmed = headingPath.trim();
    return trimmed || null;
  }

  return null;
}

function extractPageNumber(metadata: unknown): string | null {
  const record = getMetadataRecord(metadata);

  if (!record) {
    return null;
  }

  const pageNumber = record.pageNumber ?? record.page ?? record.pageIndex;

  if (typeof pageNumber === 'number') {
    return String(pageNumber);
  }

  if (typeof pageNumber === 'string') {
    const trimmed = pageNumber.trim();
    return trimmed || null;
  }

  return null;
}

function normalizeValue(value?: string | null): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  // Tránh nhúng metadata test/vô nghĩa kiểu "a", "-", "n/a".
  const lowered = trimmed.toLowerCase();

  if (['a', '-', '--', 'n/a', 'na', 'null', 'undefined'].includes(lowered)) {
    return null;
  }

  return trimmed;
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildChunkEmbeddingText(
  params: BuildChunkEmbeddingTextParams,
): string {
  const documentTitle = normalizeValue(params.documentTitle);
  const category = normalizeValue(params.category);
  const brand = normalizeValue(params.brand);
  const modelCode = normalizeValue(params.modelCode);
  const source = normalizeValue(params.source);
  const chunkTitle = normalizeValue(params.chunkTitle);
  const section = normalizeValue(params.section);
  const headingPath = extractHeadingPath(params.metadata);
  const pageNumber = extractPageNumber(params.metadata);
  const content = normalizeContent(params.content);

  const lines = [
    documentTitle ? `Tài liệu: ${documentTitle}` : null,
    category ? `Danh mục: ${category}` : null,
    brand ? `Thương hiệu: ${brand}` : null,
    modelCode ? `Model/thiết bị: ${modelCode}` : null,
    source ? `Nguồn: ${source}` : null,

    // Không nên đưa accessLevel vào embedding.
    // Quyền truy cập nên xử lý bằng filter ở query DB.

    chunkTitle ? `Tiêu đề đoạn: ${chunkTitle}` : null,
    section ? `Mục: ${section}` : null,
    headingPath ? `Đường dẫn mục: ${headingPath}` : null,
    pageNumber ? `Trang: ${pageNumber}` : null,

    `Nội dung:\n${content}`,
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}