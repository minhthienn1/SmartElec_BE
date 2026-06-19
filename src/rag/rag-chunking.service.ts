import { Injectable } from '@nestjs/common';

type ChunkingParams = {
  content: string;
  maxChars?: number;
  overlapChars?: number;
};

type ChunkingResult = {
  chunkIndex: number;
  content: string;
  charCount: number;
};

@Injectable()
export class RagChunkingService {
  chunk(params: ChunkingParams): ChunkingResult[] {
    const { content, maxChars = 1200, overlapChars = 200 } = params;
    const normalized = content.trim();

    if (!normalized) {
      return [];
    }

    const chunks: ChunkingResult[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < normalized.length) {
      let end = Math.min(start + maxChars, normalized.length);
      if (end < normalized.length) {
        const breakpoints = [
          normalized.lastIndexOf('\n\n', end),
          normalized.lastIndexOf('\n', end),
          normalized.lastIndexOf(' ', end),
        ].filter((point) => point > start + Math.floor(maxChars * 0.6));

        if (breakpoints.length > 0) {
          end = Math.max(...breakpoints);
        }
      }

      const chunkContent = normalized.slice(start, end).trim();
      if (chunkContent) {
        chunks.push({
          chunkIndex,
          content: chunkContent,
          charCount: chunkContent.length,
        });
        chunkIndex += 1;
      }

      if (end >= normalized.length) {
        break;
      }

      start = Math.max(end - overlapChars, start + 1);
    }

    return chunks;
  }
}
