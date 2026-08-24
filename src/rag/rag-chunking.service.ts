import { Injectable } from '@nestjs/common';
import { RAG_CHUNKING_HEURISTICS, RAG_HEADING_PATTERNS, RAG_LIMITS } from './rag.constants';

type ChunkingParams = {
  content: string;
  maxChars?: number;
  overlapChars?: number;
  dedupeContext?: RagDocumentDedupeContext;
  skipSourceDedupe?: boolean;
};

type ChunkingResult = {
  chunkIndex: number;
  content: string;
  charCount: number;
};

export type RagDocumentDedupeContext = {
  seenChunkKeys: Set<string>;
  seenPassageFingerprints: Map<string, DedupeFingerprint>;
};

type DedupeToken = {
  normalized: string;
  start: number;
  end: number;
};

type DedupeRange = {
  start: number;
  end: number;
  startTokenIndex: number;
  endTokenIndex: number;
};

type DedupeFingerprint = {
  tokens: string[];
  startTokenIndex: number;
};

type SourceDuplicateResult = {
  content: string;
  preservedParts: string[];
  removed: boolean;
  removedDuplicateRanges: number;
};

export type RagSourceDedupeResult = {
  content: string;
  rawLength: number;
  dedupedLength: number;
  removedDuplicateRanges: number;
};

@Injectable()
export class RagChunkingService {
  private readonly minChars = RAG_LIMITS.MIN_CHUNK_CHARS;
  private readonly minDuplicatePassageChars = 100;

  createDocumentDedupeContext(): RagDocumentDedupeContext {
    return {
      seenChunkKeys: new Set<string>(),
      seenPassageFingerprints: new Map<string, DedupeFingerprint>(),
    };
  }

  chunk(params: ChunkingParams): ChunkingResult[] {
    //lấy dữ liệu đầu vào
    const {
      content,
      maxChars = RAG_LIMITS.DEFAULT_CHUNK_MAX_CHARS,
      overlapChars = RAG_LIMITS.DEFAULT_CHUNK_OVERLAP_CHARS,
      dedupeContext = this.createDocumentDedupeContext(),
      skipSourceDedupe = false,
    } = params;

    //chuẩn hóa dữ liệu đầu vào
    const normalized = this.normalize(content);
    if (!normalized) {
      return [];
    }

    //chia các chunk dựa theo heading
    //ưu tiên chia chunk theo cấu trúc tài liệu trước và tách thành các session nhỏ
    const sections = this.splitByHeadings(normalized);

    //chia session thành các chunk nhỏ hơn dựa theo maxChars
    //hàm flatmap sẽ trả về 1 mảng các chunk nhỏ
    const rawChunks = sections.flatMap((section) =>
      this.chunkSection(section, maxChars),
    );

    //gặp chunk quá bé với chunk trước đó
    const mergedChunks = this.mergeTinyChunks(rawChunks, maxChars);
    const cleanedChunks = skipSourceDedupe
      ? mergedChunks
      : this.removeSourceDuplicates(mergedChunks, dedupeContext);

    //gán nội dung cuối chunk trước vào chunk sau để tạo ngữ cảnh
    const finalChunks = this.applySemanticOverlap(cleanedChunks, overlapChars);
    const uniqueChunks = this.removeDuplicateChunks(finalChunks);

    return uniqueChunks
      .map((chunk) => chunk.trim())
      .filter(Boolean) //xóa những chunk rỗng
      .map((chunk, index) => ({
        chunkIndex: index,
        content: chunk,
        charCount: chunk.length,
      }));
  }

  dedupeSourceText(
    content: string,
    dedupeContext: RagDocumentDedupeContext,
  ): RagSourceDedupeResult {
    const normalized = this.normalize(content);

    if (!normalized) {
      return {
        content: '',
        rawLength: content.length,
        dedupedLength: 0,
        removedDuplicateRanges: 0,
      };
    }

    const dedupeResult = this.removeSourceDuplicate(normalized, dedupeContext);

    return {
      content: dedupeResult.content,
      rawLength: normalized.length,
      dedupedLength: dedupeResult.content.length,
      removedDuplicateRanges: dedupeResult.removedDuplicateRanges,
    };
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

    if (
      text.length < RAG_CHUNKING_HEURISTICS.MIN_HEADING_CHARS ||
      text.length > RAG_CHUNKING_HEURISTICS.MAX_HEADING_CHARS
    ) {
      return false;
    }

    return RAG_HEADING_PATTERNS.some((pattern) => pattern.test(text));
  }

  //lấy các chunk theo heading
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

  //chia session thành các chunk nhỏ hơn dựa theo maxChars
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

  //chia 1 đoạn text dài thành các chunk nhỏ hơn dựa theo maxChars
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

  //lấy ít nhất 1 đoạn nội dung cuối chunk trước và gán vào chunk sau
  private applySemanticOverlap(chunks: string[], overlapChars: number): string[] {
    if (overlapChars <= 0 || chunks.length <= 1) {
      return chunks;
    }

    return chunks.map((chunk, index) => {
      if (index === 0) {
        return chunk;
      }

      //lấy phần cuối của chunk trước, nhưng không vượt quá overlapChars
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
        if (picked.length === 0) {
          return this.getReadableTail(line, maxChars);
        }

        break;
      }

      if (total + line.length > maxChars) {
        break;
      }

      picked.unshift(line);
      total += line.length;
    }

    return picked.join('\n').trim();
  }

  private getReadableTail(line: string, maxChars: number): string {
    const trimmed = line.trim();

    if (trimmed.length <= maxChars) {
      return trimmed;
    }

    const start = Math.max(0, trimmed.length - maxChars);
    const whitespaceIndex = trimmed.search(/\s/);
    const boundary = trimmed.slice(start).search(/\s/);

    if (boundary > 0) {
      return trimmed.slice(start + boundary + 1).trim();
    }

    if (whitespaceIndex >= 0 && start > 0) {
      return trimmed.slice(start).replace(/^\S+\s*/, '').trim();
    }

    return trimmed.slice(start).trim();
  }

  private removeDuplicateChunks(chunks: string[]): string[] {
    const seen = new Set<string>();
    const uniqueChunks: string[] = [];

    for (const chunk of chunks) {
      const normalized = this.normalizeForDeduplication(chunk);

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      uniqueChunks.push(chunk);
    }

    return uniqueChunks;
  }

  private removeSourceDuplicates(
    chunks: string[],
    dedupeContext: RagDocumentDedupeContext,
  ): string[] {
    const cleanedChunks: string[] = [];

    for (const chunk of chunks) {
      const dedupeResult = this.removeSourceDuplicate(chunk, dedupeContext);

      if (dedupeResult.content.trim()) {
        cleanedChunks.push(dedupeResult.content);
      }
    }

    return cleanedChunks;
  }

  private removeSourceDuplicate(
    content: string,
    dedupeContext: RagDocumentDedupeContext,
  ): SourceDuplicateResult {
    const chunkKey = this.normalizeForDeduplication(content);

    if (!chunkKey || dedupeContext.seenChunkKeys.has(chunkKey)) {
      return {
        content: '',
        preservedParts: [],
        removed: true,
        removedDuplicateRanges: chunkKey ? 1 : 0,
      };
    }

    const dedupeResult = this.removeRepeatedPassages(content, dedupeContext);
    const cleanedKey = this.normalizeForDeduplication(dedupeResult.content);

    if (!cleanedKey || dedupeContext.seenChunkKeys.has(cleanedKey)) {
      return {
        content: '',
        preservedParts: [],
        removed: true,
        removedDuplicateRanges: dedupeResult.removedDuplicateRanges,
      };
    }

    if (!dedupeResult.removed) {
      dedupeContext.seenChunkKeys.add(cleanedKey);
    }

    for (const preservedPart of dedupeResult.preservedParts) {
      const preservedKey = this.normalizeForDeduplication(preservedPart);

      if (preservedKey) {
        dedupeContext.seenChunkKeys.add(preservedKey);
      }

      this.registerPassageFingerprints(preservedPart, dedupeContext);
    }

    return dedupeResult;
  }

  private removeRepeatedPassages(
    content: string,
    dedupeContext: RagDocumentDedupeContext,
  ): SourceDuplicateResult {
    const blockDedupeResult = this.removeDuplicateBlocks(content, dedupeContext);
    const tokens = this.tokenizeForDeduplication(blockDedupeResult.content);
    const ranges = this.findDuplicateRanges(
      tokens,
      dedupeContext,
      !blockDedupeResult.removed,
    );

    if (ranges.length === 0) {
      return {
        content: blockDedupeResult.content,
        preservedParts: blockDedupeResult.preservedParts,
        removed: blockDedupeResult.removed,
        removedDuplicateRanges: blockDedupeResult.removedDuplicateRanges,
      };
    }

    const rangeResult = this.removeRanges(blockDedupeResult.content, ranges);

    return {
      ...rangeResult,
      removedDuplicateRanges:
        blockDedupeResult.removedDuplicateRanges +
        rangeResult.removedDuplicateRanges,
    };
  }
  private removeDuplicateBlocks(
    content: string,
    dedupeContext: RagDocumentDedupeContext,
  ): SourceDuplicateResult {
    const blocks = content
      .split(/\n+/)
      .map((block) => block.trim())
      .filter(Boolean);

    const preservedParts: string[] = [];
    let removedDuplicateRanges = 0;

    for (const block of blocks) {
      const key = this.normalizeForDeduplication(block);

      if (
        key.length >= RAG_CHUNKING_HEURISTICS.MIN_DUPLICATE_PASSAGE_CHARS &&
        dedupeContext.seenChunkKeys.has(key)
      ) {
        removedDuplicateRanges += 1;
        continue;
      }

      preservedParts.push(block);
    }

    return {
      content: this.normalize(preservedParts.join('\n')),
      preservedParts,
      removed: removedDuplicateRanges > 0,
      removedDuplicateRanges,
    };
  }

  private tokenizeForDeduplication(text: string): DedupeToken[] {
    const tokens: DedupeToken[] = [];
    const matcher = /\S+/g;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(text)) !== null) {
      tokens.push({
        normalized: match[0].toLowerCase(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return tokens;
  }

  private findDuplicateRanges(
    tokens: DedupeToken[],
    dedupeContext: RagDocumentDedupeContext,
    registerNewFingerprints = true,
  ): DedupeRange[] {
    const ranges: DedupeRange[] = [];
    const tokenValues = tokens.map((token) => token.normalized);

    for (let start = 0; start < tokens.length; start += 1) {
      const window = this.buildMinimumPassageWindow(tokens, start);
      if (!window) {
        break;
      }

      const fingerprint = dedupeContext.seenPassageFingerprints.get(window.key);
      if (fingerprint) {
        const extendedEndTokenIndex = this.extendDuplicateRange(
          tokens,
          start,
          window.endTokenIndex,
          fingerprint,
        );

        ranges.push({
          start: tokens[start].start,
          end: tokens[extendedEndTokenIndex].end,
          startTokenIndex: start,
          endTokenIndex: extendedEndTokenIndex,
        });

        start = extendedEndTokenIndex;
      } else if (registerNewFingerprints) {
        dedupeContext.seenPassageFingerprints.set(window.key, {
          tokens: tokenValues,
          startTokenIndex: start,
        });
      }
    }

    return this.mergeRanges(ranges);
  }

  private registerPassageFingerprints(
    content: string,
    dedupeContext: RagDocumentDedupeContext,
  ) {
    const tokens = this.tokenizeForDeduplication(content);
    const tokenValues = tokens.map((token) => token.normalized);

    for (let start = 0; start < tokens.length; start += 1) {
      const window = this.buildMinimumPassageWindow(tokens, start);
      if (!window) {
        break;
      }

      if (!dedupeContext.seenPassageFingerprints.has(window.key)) {
        dedupeContext.seenPassageFingerprints.set(window.key, {
          tokens: tokenValues,
          startTokenIndex: start,
        });
      }
    }
  }

  private extendDuplicateRange(
    tokens: DedupeToken[],
    currentStartTokenIndex: number,
    currentEndTokenIndex: number,
    fingerprint: DedupeFingerprint,
  ): number {
    let currentEnd = currentEndTokenIndex;
    let seenEnd =
      fingerprint.startTokenIndex +
      (currentEndTokenIndex - currentStartTokenIndex);

    while (
      currentEnd + 1 < tokens.length &&
      seenEnd + 1 < fingerprint.tokens.length &&
      tokens[currentEnd + 1].normalized === fingerprint.tokens[seenEnd + 1]
    ) {
      currentEnd += 1;
      seenEnd += 1;
    }

    return currentEnd;
  }

  private buildMinimumPassageWindow(
    tokens: DedupeToken[],
    start: number,
  ): { key: string; endTokenIndex: number } | null {
    const parts: string[] = [];
    let length = 0;

    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index].normalized;
      parts.push(token);
      length += token.length + (parts.length > 1 ? 1 : 0);

      if (length >= RAG_CHUNKING_HEURISTICS.MIN_DUPLICATE_PASSAGE_CHARS) {
        return {
          key: parts.join(' '),
          endTokenIndex: index,
        };
      }
    }

    return null;
  }

  private mergeRanges(ranges: DedupeRange[]): DedupeRange[] {
    if (ranges.length <= 1) {
      return ranges;
    }

    const sortedRanges = [...ranges].sort((left, right) => left.start - right.start);
    const mergedRanges: DedupeRange[] = [sortedRanges[0]];

    for (const range of sortedRanges.slice(1)) {
      const previous = mergedRanges[mergedRanges.length - 1];

      if (range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        mergedRanges.push({ ...range });
      }
    }

    return mergedRanges;
  }

  private removeRanges(
    content: string,
    ranges: DedupeRange[],
  ): SourceDuplicateResult {
    let result = '';
    let cursor = 0;
    const preservedParts: string[] = [];

    for (const range of ranges) {
      const preservedPart = content.slice(cursor, range.start);
      result += preservedPart;

      if (preservedPart.trim()) {
        preservedParts.push(preservedPart);
      }

      cursor = range.end;
    }

    const tailPart = content.slice(cursor);
    result += tailPart;

    if (tailPart.trim()) {
      preservedParts.push(tailPart);
    }

    return {
      content: this.normalize(result),
      preservedParts,
      removed: true,
      removedDuplicateRanges: ranges.length,
    };
  }

  private normalizeForDeduplication(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
}
