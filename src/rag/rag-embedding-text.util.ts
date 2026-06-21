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

function extractHeadingPath(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const headingPath = (metadata as Record<string, unknown>).headingPath;
  if (Array.isArray(headingPath)) {
    const parts = headingPath
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts.join(' > ') : null;
  }

  if (typeof headingPath === 'string') {
    const trimmed = headingPath.trim();
    return trimmed || null;
  }

  return null;
}

export function buildChunkEmbeddingText(
  params: BuildChunkEmbeddingTextParams,
): string {
  const lines = [
    `Tài liệu: ${params.documentTitle.trim()}`,
    params.category ? `Danh mục: ${params.category.trim()}` : null,
    params.brand ? `Thương hiệu: ${params.brand.trim()}` : null,
    params.modelCode ? `Model: ${params.modelCode.trim()}` : null,
    params.source ? `Nguồn: ${params.source.trim()}` : null,
    params.accessLevel ? `Quyền truy cập: ${params.accessLevel}` : null,
    params.chunkTitle ? `Chunk: ${params.chunkTitle.trim()}` : null,
    params.section ? `Mục: ${params.section.trim()}` : null,
    extractHeadingPath(params.metadata)
      ? `Heading path: ${extractHeadingPath(params.metadata)}`
      : null,
    `Nội dung:\n${params.content.trim()}`,
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
}
