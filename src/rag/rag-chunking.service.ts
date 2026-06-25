import { Injectable } from '@nestjs/common';
import { RAG_LIMITS } from './rag.constants';

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
  private readonly minChars = RAG_LIMITS.MIN_CHUNK_CHARS;

  chunk(params: ChunkingParams): ChunkingResult[] {
    const {
      content,
      maxChars = RAG_LIMITS.DEFAULT_CHUNK_MAX_CHARS,
      overlapChars = RAG_LIMITS.DEFAULT_CHUNK_OVERLAP_CHARS,
    } = params;

    const normalized = this.normalize(content);
    if (!normalized) {
      return [];
    }

    const sections = this.splitByHeadings(normalized);
    const rawChunks = sections.flatMap((section) =>
      this.chunkSection(section, maxChars),
    );

    const mergedChunks = this.mergeTinyChunks(rawChunks, maxChars);
    const finalChunks = this.applySemanticOverlap(mergedChunks, overlapChars);

    return finalChunks
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk, index) => ({
        chunkIndex: index,
        content: chunk,
        charCount: chunk.length,
      }));
  }

  private normalize(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isHeading(line: string): boolean {
    const text = line.trim();

    if (text.length < 3 || text.length > 140) {
      return false;
    }

    return (
      /^chương\s+[ivxlcdm\d]+/i.test(text) ||
      /^chuong\s+[ivxlcdm\d]+/i.test(text) ||
      /^bài\s+\d+/i.test(text) ||
      /^bai\s+\d+/i.test(text) ||
      /^mục\s+\d+/i.test(text) ||
      /^muc\s+\d+/i.test(text) ||
      /^phần\s+\d+/i.test(text) ||
      /^phan\s+\d+/i.test(text) ||
      /^\d+(\.\d+){1,5}\.?\s+.+/.test(text) ||
      /^[IVXLCDM]+\.\s+.+/i.test(text) ||
      /^[A-ZĐ][A-ZÀ-Ỹ0-9\s,()/.-]{10,}$/.test(text)
    );
  }

  private splitByHeadings(text: string): string[] {
    const lines = text.split('\n');
    const sections: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (this.isHeading(trimmed) && current.length > 0) {
        const currentText = current.join('\n').trim();
        if (currentText) {
          sections.push(currentText);
        }
        current = [trimmed];
      } else {
        current.push(line);
      }
    }

    const lastText = current.join('\n').trim();
    if (lastText) {
      sections.push(lastText);
    }

    return sections.filter(Boolean);
  }

  private chunkSection(section: string, maxChars: number): string[] {
    if (section.length <= maxChars) {
      return [section];
    }

    const blocks = section
      .split(/\n+/)
      .map((block) => block.trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let current = '';

    for (const block of blocks) {
      if (block.length > maxChars) {
        if (current.trim()) {
          chunks.push(current.trim());
          current = '';
        }

        chunks.push(...this.splitLongText(block, maxChars));
        continue;
      }

      const next = current ? `${current}\n${block}` : block;

      if (next.length > maxChars && current.length >= this.minChars) {
        chunks.push(current.trim());
        current = block;
      } else {
        current = next;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  private splitLongText(text: string, maxChars: number): string[] {
    const sentences =
      text.match(/[^.!?。！？:;]+[.!?。！？:;]?/gu)?.map((item) => item.trim()) ??
      [];

    if (sentences.length <= 1) {
      return this.hardSplitByWhitespace(text, maxChars);
    }

    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;

      if (next.length > maxChars && current.length >= this.minChars) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = next;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.flatMap((chunk) =>
      chunk.length > maxChars
        ? this.hardSplitByWhitespace(chunk, maxChars)
        : [chunk],
    );
  }

  private hardSplitByWhitespace(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);

      if (end < text.length) {
        const breakPoint = text.lastIndexOf(' ', end);

        if (breakPoint > start + Math.floor(maxChars * 0.65)) {
          end = breakPoint;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      if (end >= text.length) {
        break;
      }

      start = end;
    }

    return chunks;
  }

  private mergeTinyChunks(chunks: string[], maxChars: number): string[] {
    const merged: string[] = [];

    for (const chunk of chunks) {
      const last = merged[merged.length - 1];

      if (last && chunk.length < this.minChars) {
        const combined = `${last}\n${chunk}`;

        if (combined.length <= maxChars) {
          merged[merged.length - 1] = combined;
          continue;
        }
      }

      merged.push(chunk);
    }

    return merged;
  }

  private applySemanticOverlap(chunks: string[], overlapChars: number): string[] {
    if (overlapChars <= 0 || chunks.length <= 1) {
      return chunks;
    }

    return chunks.map((chunk, index) => {
      if (index === 0) {
        return chunk;
      }

      const context = this.getTailContext(chunks[index - 1], overlapChars);
      if (!context) {
        return chunk;
      }

      return `${context}\n${chunk}`.trim();
    });
  }

  private getTailContext(content: string, maxChars: number): string {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const picked: string[] = [];
    let total = 0;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];

      if (line.length > maxChars) {
        continue;
      }

      if (total + line.length > maxChars) {
        break;
      }

      picked.unshift(line);
      total += line.length;
    }

    return picked.join('\n').trim();
  }
}
