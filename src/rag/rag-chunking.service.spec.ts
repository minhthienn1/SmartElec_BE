import { RagChunkingService } from './rag-chunking.service';
import { RagIngestionService } from './rag-ingestion.service';

const repeatedText = (prefix: string, count = 24) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');

const repeatedCharText = (char: string, length: number) =>
  `${char.repeat(length - 12)}_${length}_chars`;

type BuildSegmentsForTest = {
  buildSegments: (
    title: string,
    content: string,
    metadata: Record<string, unknown> | undefined,
    segments: Array<{ content: string; section?: string | null }>,
  ) => Array<{ content: string }>;
};

describe('RagChunkingService document duplicate handling', () => {
  let service: RagChunkingService;

  beforeEach(() => {
    service = new RagChunkingService();
  });

  it('keeps only one whole chunk duplicate in one document context', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('whole');

    const first = service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    const second = service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('removes duplicate passage at the start and keeps new content', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('start');

    service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `${duplicate}\nNEW_START_CONTENT`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).not.toContain(duplicate);
    expect(result[0].content).toContain('NEW_START_CONTENT');
  });

  it('removes duplicate passage in the middle and keeps both sides', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('middle');

    service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_A\n${duplicate}\nNEW_B`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).not.toContain(duplicate);
    expect(result[0].content).toContain('NEW_A');
    expect(result[0].content).toContain('NEW_B');
  });

  it('removes duplicate passage at the end and keeps new content', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('end');

    service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_END_CONTENT\n${duplicate}`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).toContain('NEW_END_CONTENT');
    expect(result[0].content).not.toContain(duplicate);
  });

  it('removes non-adjacent duplicate passages in one document context', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('weather');

    service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    service.chunk({
      content: 'UNRELATED_CONTENT_ONLY',
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_D\n${duplicate}\nNEW_E`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).not.toContain(duplicate);
    expect(result[0].content).toContain('NEW_D');
    expect(result[0].content).toContain('NEW_E');
  });

  it('removes cross-segment duplicate passages when ingestion uses one document context', () => {
    const ingestion = new RagIngestionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
    );
    const duplicate = repeatedText('segment');
    const ingestionForTest = ingestion as unknown as BuildSegmentsForTest;

    const newD = repeatedText('newD', 24);
    const newE = repeatedText('newE', 24);
    const result = ingestionForTest.buildSegments('Document', '', undefined, [
      { content: `AAA\n${duplicate}\nBBB`, section: 'segment-1' },
      { content: repeatedText('segment2', 24), section: 'segment-2' },
      { content: `${newD}\n${duplicate}\n${newE}`, section: 'segment-5' },
    ]);

    expect(result[0].content).toContain(duplicate);
    expect(result[2].content).not.toContain(duplicate);
    expect(result[2].content).toContain(newD);
    expect(result[2].content).toContain(newE);
  });

  it('preserves short unique content that remains after cross-segment dedupe', () => {
    const ingestion = new RagIngestionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
    );
    const ingestionForTest = ingestion as unknown as BuildSegmentsForTest;
    const duplicate = repeatedText('loss', 30);
    const uniqueFragment = 'Loi E05: kiem tra cam bien nhiet do.';

    const result = ingestionForTest.buildSegments('Document', '', undefined, [
      { content: duplicate, section: 'segment-1' },
      { content: `${duplicate}\n${uniqueFragment}`, section: 'segment-2' },
    ]);

    expect(result.map((segment) => segment.content).join('\n')).toContain(
      uniqueFragment,
    );
  });

  it('keeps at least one short unique occurrence after duplicate removal', () => {
    const ingestion = new RagIngestionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
    );
    const ingestionForTest = ingestion as unknown as BuildSegmentsForTest;
    const duplicate = repeatedText('repeatShort', 30);
    const uniqueFragment = 'UNIQUE_SHORT_E05_FRAGMENT';

    const result = ingestionForTest.buildSegments('Document', '', undefined, [
      { content: `${duplicate}\n${uniqueFragment}`, section: 'segment-1' },
      { content: `${duplicate}\n${uniqueFragment}`, section: 'segment-2' },
    ]);

    expect(result.map((segment) => segment.content).join('\n')).toContain(
      uniqueFragment,
    );
  });

  it('removes multiple duplicate passages in one chunk and preserves new content', () => {
    const context = service.createDocumentDedupeContext();
    const dup1 = repeatedText('dupA');
    const dup2 = repeatedText('dupB');
    const dup3 = repeatedText('dupC');

    service.chunk({
      content: `${dup1}\n${dup2}\n${dup3}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_A\n${dup1}\nNEW_B\n${dup2}\nNEW_C\n${dup3}\nNEW_D`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).not.toContain(dup1);
    expect(result[0].content).not.toContain(dup2);
    expect(result[0].content).not.toContain(dup3);
    expect(result[0].content).toContain('NEW_A');
    expect(result[0].content).toContain('NEW_B');
    expect(result[0].content).toContain('NEW_C');
    expect(result[0].content).toContain('NEW_D');
  });

  it('uses the 100-character threshold for duplicate passages', () => {
    const shortContext = service.createDocumentDedupeContext();
    const exactContext = service.createDocumentDedupeContext();
    const longContext = service.createDocumentDedupeContext();
    const shortDuplicate = 'a'.repeat(99);
    const exactDuplicate = 'b'.repeat(100);
    const longDuplicate = 'c'.repeat(120);

    service.chunk({
      content: shortDuplicate,
      overlapChars: 0,
      dedupeContext: shortContext,
    });
    service.chunk({
      content: exactDuplicate,
      overlapChars: 0,
      dedupeContext: exactContext,
    });
    service.chunk({
      content: longDuplicate,
      overlapChars: 0,
      dedupeContext: longContext,
    });

    expect(
      service.chunk({
        content: `NEW ${shortDuplicate} TAIL`,
        overlapChars: 0,
        dedupeContext: shortContext,
      })[0].content,
    ).toContain(shortDuplicate);
    expect(
      service.chunk({
        content: `NEW ${exactDuplicate} TAIL`,
        overlapChars: 0,
        dedupeContext: exactContext,
      })[0].content,
    ).not.toContain(exactDuplicate);
    expect(
      service.chunk({
        content: `NEW ${longDuplicate} TAIL`,
        overlapChars: 0,
        dedupeContext: longContext,
      })[0].content,
    ).not.toContain(longDuplicate);
  });

  it('treats whitespace-normalized duplicate passages as equivalent', () => {
    const context = service.createDocumentDedupeContext();
    const words = repeatedText('space');
    const newlineVersion = words.replace(/ /g, '\n     ');

    service.chunk({ content: words, overlapChars: 0, dedupeContext: context });
    const result = service.chunk({
      content: `NEW_A\n${newlineVersion}\nNEW_B`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).toContain('NEW_A');
    expect(result[0].content).toContain('NEW_B');
    expect(result[0].content).not.toContain('space0');
  });

  it('keeps intentional overlap after source duplicate removal', () => {
    const firstLine = repeatedText('alpha', 18);
    const overlapLine = repeatedText('beta', 18);
    const nextLine = repeatedText('gamma', 18);

    const result = service.chunk({
      content: `${firstLine}\n\n${overlapLine}\n\n${nextLine}`,
      maxChars: 300,
      overlapChars: 160,
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1].content.startsWith(overlapLine)).toBe(true);
  });

  it('creates readable overlap from a long paragraph without newlines', () => {
    const longParagraph = repeatedText('longParagraph', 42);
    const nextParagraph = repeatedText('nextParagraph', 18);
    const expectedTail = longParagraph.split(' ').slice(-10).join(' ');

    const result = service.chunk({
      content: `${longParagraph}\n\n${nextParagraph}`,
      maxChars: 640,
      overlapChars: 160,
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1].content.replace(/\s+/g, ' ')).toContain(expectedTail);
    expect(result[1].content).not.toMatch(/^\S{1,3}Paragraph/);
  });

  it('removes the tail of a 180-character duplicate passage, not only the first window', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('dup180', 24);
    const duplicateTail = duplicate.split(' ').slice(-6).join(' ');

    service.chunk({
      content: `FIRST ${duplicate}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_A ${duplicate} NEW_B`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).toContain('NEW_A');
    expect(result[0].content).toContain('NEW_B');
    expect(result[0].content).not.toContain(duplicateTail);
  });

  it('removes the tail of a 300-plus-character duplicate passage', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('dupLong', 52);
    const duplicateTail = duplicate.split(' ').slice(-10).join(' ');

    service.chunk({
      content: `FIRST ${duplicate}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `NEW_LONG_A ${duplicate} NEW_LONG_B`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).toContain('NEW_LONG_A');
    expect(result[0].content).toContain('NEW_LONG_B');
    expect(result[0].content).not.toContain(duplicateTail);
  });

  it('does not register synthetic fingerprints across removed duplicate boundaries', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('removedBoundary', 30);
    const leftUnique = repeatedCharText('a', 60);
    const rightUnique = repeatedCharText('b', 60);
    const realAdjacentSource = `${leftUnique} ${rightUnique}`;

    service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: context,
    });
    service.chunk({
      content: `${leftUnique}\n${duplicate}\n${rightUnique}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: realAdjacentSource,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).toContain(leftUnique);
    expect(result[0].content).toContain(rightUnique);
  });

  it('stops duplicate extension at the first different suffix token', () => {
    const context = service.createDocumentDedupeContext();
    const commonPrefix = repeatedText('commonPrefix', 16);
    const oldSuffix = 'OLD_SUFFIX OLD_SUFFIX OLD_SUFFIX OLD_SUFFIX';
    const newSuffix = 'NEW_SUFFIX NEW_SUFFIX NEW_SUFFIX NEW_SUFFIX';

    service.chunk({
      content: `${commonPrefix} ${oldSuffix}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `${commonPrefix} ${newSuffix}`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result[0].content).not.toContain(commonPrefix);
    expect(result[0].content).toContain(newSuffix);
  });

  it('removes the full duplicate when the same fingerprint has multiple continuations', () => {
    const context = service.createDocumentDedupeContext();
    const commonPrefix = repeatedText('multiPrefix', 16);
    const suffixA = 'AAA AAA AAA AAA';
    const suffixB = 'BBB BBB BBB BBB';

    service.chunk({
      content: `${commonPrefix} ${suffixA}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    service.chunk({
      content: `${commonPrefix} ${suffixB}`,
      overlapChars: 0,
      dedupeContext: context,
    });
    const result = service.chunk({
      content: `${commonPrefix} ${suffixB}`,
      overlapChars: 0,
      dedupeContext: context,
    });

    expect(result).toHaveLength(0);
  });

  it('removes repeated passages inside one source content while preserving middle content', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('sameContentE05', 24);
    const content = `${duplicate}\nB_UNIQUE_CONTENT\n${duplicate}\nC_UNIQUE_CONTENT\n${duplicate}`;

    const result = service.dedupeSourceText(content, context);
    const occurrences = result.content.split(duplicate).length - 1;

    expect(occurrences).toBe(1);
    expect(result.content).toContain('B_UNIQUE_CONTENT');
    expect(result.content).toContain('C_UNIQUE_CONTENT');
    expect(result.removedDuplicateRanges).toBe(2);
  });

  it('does not leak dedupe context between different documents', () => {
    const duplicate = repeatedText('document');
    const documentA = service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: service.createDocumentDedupeContext(),
    });
    const documentB = service.chunk({
      content: duplicate,
      overlapChars: 0,
      dedupeContext: service.createDocumentDedupeContext(),
    });

    expect(documentA).toHaveLength(1);
    expect(documentB).toHaveLength(1);
  });

  it('handles a 300-chunk document without explosive substring enumeration', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate = repeatedText('bench');

    for (let index = 0; index < 300; index += 1) {
      const result = service.chunk({
        content:
          index === 0
            ? `FIRST ${duplicate}`
            : `UNIQUE_${index} ${duplicate} TAIL_${index}`,
        overlapChars: 0,
        dedupeContext: context,
      });

      expect(result.length).toBeLessThanOrEqual(1);
    }
  });

  it('removes repeated source paragraphs inside one imported document', () => {
    const context = service.createDocumentDedupeContext();
    const duplicate =
      'Khi máy giặt báo lỗi E05, người dùng cần kiểm tra đường cấp nước trước tiên. ' +
      'Hãy chắc chắn rằng van cấp nước đã mở hoàn toàn, lưới lọc đầu vào không bị nghẹt bởi cặn bẩn, ' +
      'ống cấp nước không bị gấp khúc và áp lực nước trong nhà đủ mạnh để máy nạp nước trong thời gian quy định. ' +
      'Nếu máy vẫn báo lỗi sau khi vệ sinh lưới lọc và mở lại van nước, hãy tắt nguồn máy trong năm phút rồi khởi động lại chu trình giặt.';

    const content = `${duplicate}
      Thông tin riêng B

      ${duplicate}
      Đoạn ngắn unique sau duplicate

      ${duplicate}
      Đoạn unique cuối`;

    const result = service.dedupeSourceText(content, context);

    expect(result.content.split(duplicate).length - 1).toBe(1);
    expect(result.content).toContain('Thông tin riêng B');
    expect(result.content).toContain('Đoạn ngắn unique sau duplicate');
    expect(result.content).toContain('Đoạn unique cuối');
  });
});
