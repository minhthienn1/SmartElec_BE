import { Injectable } from '@nestjs/common';

export type AiIntentType =
  | 'GREETING'
  | 'EMERGENCY'
  | 'EXPLICIT_BOOKING'
  | 'TECHNICAL_SPECIFIC'
  | 'TECHNICAL_VAGUE'
  | 'OUT_OF_SCOPE_TECHNICAL'
  | 'NORMAL';

export type SupportedDeviceCategory =
  | 'AIR_CONDITIONER'
  | 'WASHING_MACHINE'
  | 'REFRIGERATOR'
  | 'MICROWAVE'
  | 'ELECTRICAL'
  | 'OTHER_HOME_APPLIANCE'
  | 'UNKNOWN';

export type OutOfScopeDeviceCategory =
  | 'LAPTOP'
  | 'PHONE'
  | 'PRINTER'
  | 'COMPUTER'
  | 'UNKNOWN';

export interface AiIntentGateResult {
  originalText: string;
  normalizedText: string;
  expandedText: string;

  intent: AiIntentType;

  isGreeting: boolean;
  isEmergency: boolean;
  isExplicitBooking: boolean;
  isTechnical: boolean;
  isTechnicalSpecific: boolean;
  isTechnicalVague: boolean;
  isOutOfScope: boolean;
  hasMojibakeSignal: boolean;

  supportedDeviceCategory: SupportedDeviceCategory;
  outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;

  detectedDeviceLabel: string | null;
  detectedIssueLabel: string | null;
  detectedBrand: string | null;
  detectedErrorCode: string | null;

  shouldUseRag: boolean;
  shouldAskClarification: boolean;
  shouldReturnDirectResponse: boolean;

  directResponse: string | null;
  reasons: string[];
}

@Injectable()
export class AiIntentGateService {
  analyze(message: string): AiIntentGateResult {
    const originalText = (message ?? '').trim();
    const normalizedText = this.normalizeIntentText(originalText);
    const expandedText = this.expandCommonAbbreviations(normalizedText);

    const hasMojibakeSignal = this.hasMojibakeSignal(originalText);

    const supportedDeviceCategory =
      this.inferSupportedDeviceCategory(expandedText);
    const outOfScopeDeviceCategory =
      this.inferOutOfScopeDeviceCategory(expandedText);

    const detectedDeviceLabel = this.inferDeviceLabel(
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
    );

    const detectedBrand = this.inferBrand(expandedText);
    const detectedErrorCode = this.inferErrorCode(originalText, expandedText);
    const detectedIssueLabel = this.inferIssueLabel(expandedText);

    const isEmergency = this.isEmergencyIntent(originalText, expandedText);
    const isExplicitBooking = this.hasExplicitBookingPhrase(expandedText);

    const isOutOfScope =
      outOfScopeDeviceCategory !== null &&
      supportedDeviceCategory === 'UNKNOWN';

    const isTechnicalSpecific = this.isTechnicalSpecificIntent({
      originalText,
      expandedText,
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      detectedBrand,
      detectedErrorCode,
      detectedIssueLabel,
    });

    const isTechnicalVague = this.isTechnicalVagueIntent({
      expandedText,
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      detectedIssueLabel,
      isTechnicalSpecific,
    });

    const hasProblemContext =
      isEmergency ||
      isExplicitBooking ||
      isOutOfScope ||
      isTechnicalSpecific ||
      isTechnicalVague;

    const isGreeting = this.isGreetingIntent(expandedText, hasProblemContext);

    let intent: AiIntentType = 'NORMAL';
    const reasons: string[] = [];

    if (hasMojibakeSignal) {
      reasons.push('MESSAGE_HAS_MOJIBAKE_SIGNAL');
    }

    if (isEmergency) {
      intent = 'EMERGENCY';
      reasons.push('MATCHED_EMERGENCY');
    } else if (isExplicitBooking) {
      intent = 'EXPLICIT_BOOKING';
      reasons.push('MATCHED_EXPLICIT_BOOKING');
    } else if (isGreeting) {
      intent = 'GREETING';
      reasons.push('MATCHED_GREETING');
    } else if (isOutOfScope && (isTechnicalSpecific || isTechnicalVague)) {
      intent = 'OUT_OF_SCOPE_TECHNICAL';
      reasons.push('MATCHED_OUT_OF_SCOPE_TECHNICAL');
    } else if (isTechnicalSpecific) {
      intent = 'TECHNICAL_SPECIFIC';
      reasons.push('MATCHED_TECHNICAL_SPECIFIC');
    } else if (isTechnicalVague) {
      intent = 'TECHNICAL_VAGUE';
      reasons.push('MATCHED_TECHNICAL_VAGUE');
    }

    const directResponse = this.buildDirectResponse({
      intent,
      hasMojibakeSignal,
      detectedDeviceLabel,
      detectedIssueLabel,
      detectedBrand,
      detectedErrorCode,
      outOfScopeDeviceCategory,
    });

    return {
      originalText,
      normalizedText,
      expandedText,

      intent,

      isGreeting,
      isEmergency,
      isExplicitBooking,
      isTechnical: isTechnicalSpecific || isTechnicalVague,
      isTechnicalSpecific,
      isTechnicalVague,
      isOutOfScope,
      hasMojibakeSignal,

      supportedDeviceCategory,
      outOfScopeDeviceCategory,

      detectedDeviceLabel,
      detectedIssueLabel,
      detectedBrand,
      detectedErrorCode,

      shouldUseRag: intent === 'TECHNICAL_SPECIFIC',
      shouldAskClarification: intent === 'TECHNICAL_VAGUE',
      shouldReturnDirectResponse:
        intent === 'GREETING' ||
        intent === 'EMERGENCY' ||
        intent === 'EXPLICIT_BOOKING' ||
        intent === 'OUT_OF_SCOPE_TECHNICAL' ||
        intent === 'TECHNICAL_VAGUE' ||
        hasMojibakeSignal,

      directResponse,
      reasons,
    };
  }

  normalizeIntentText(text: string): string {
    return (text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  expandCommonAbbreviations(normalizedText: string): string {
    let text = ` ${normalizedText} `;

    const replacements: Array<[RegExp, string]> = [
      [/\bko\b/g, ' khong '],
      [/\bk\b/g, ' khong '],
      [/\bkh\b/g, ' khong '],
      [/\bhok\b/g, ' khong '],
      [/\bhong\b/g, ' khong '],

      [/\bdc\b/g, ' duoc '],
      [/\bdk\b/g, ' duoc '],
      [/\bok\b/g, ' duoc '],

      [/\bsdt\b/g, ' so dien thoai '],
      [/\bs d t\b/g, ' so dien thoai '],

      [/\bq\s*(\d{1,2})\b/g, ' quan $1 '],
      [/\bq\.\s*(\d{1,2})\b/g, ' quan $1 '],

      [/\bhnay\b/g, ' hom nay '],
      [/\btmai\b/g, ' ngay mai '],
      [/\btrua mai\b/g, ' trua ngay mai '],
      [/\bchieu mai\b/g, ' chieu ngay mai '],

      [/\bremote\b/g, ' dieu khien '],
      [/\bcuc nong\b/g, ' cuc nong '],
      [/\bcuc lanh\b/g, ' cuc lanh '],

      // Chỉ map ml/mg khi có ngữ cảnh lỗi phổ biến để tránh hiểu nhầm đơn vị đo.
      [/\bml\s+(khong|k|ko|hong|mat|lanh|chay|hu|loi|sua)\b/g, ' may lanh $1'],
      [/\bmg\s+(khong|k|ko|hong|vat|xa|chay|hu|loi|sua)\b/g, ' may giat $1'],
    ];

    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }

    return text.replace(/\s+/g, ' ').trim();
  }

  private hasMojibakeSignal(originalText: string): boolean {
    const suspiciousPatterns = [
      /Ã./,
      /Â./,
      /áº./,
      /á»./,
      /Ä./,
      /Æ./,
      /ï¿½/,
      /�/,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(originalText));
  }

  private isGreetingIntent(
    expandedText: string,
    hasProblemContext: boolean,
  ): boolean {
    if (hasProblemContext) {
      return false;
    }

    return [
      /^xin chao$/,
      /^chao$/,
      /^chao ban$/,
      /^hello$/,
      /^hi$/,
      /^alo$/,
      /^ad oi$/,
      /^shop oi$/,
    ].some((pattern) => pattern.test(expandedText));
  }

  private hasExplicitBookingPhrase(expandedText: string): boolean {
    return this.includesAnyPhrase(expandedText, [
      'dat tho',
      'goi tho',
      'can tho',
      'dat lich',
      'book tho',
      'cho tho toi',
      'cho ky thuat toi',
      'tao yeu cau sua chua',
      'toi muon dat tho',
      'toi can dat tho',
      'toi muon goi tho',
    ]);
  }

  private isEmergencyIntent(
    originalText: string,
    expandedText: string,
  ): boolean {
    const originalLower = originalText.toLowerCase();

    // Dùng bản gốc để phân biệt "cháy" với "chạy", "nổ" với "nó".
    const originalEmergencyPatterns = [
      /bốc\s*khói/i,
      /có\s*khói/i,
      /mùi\s*khét/i,
      /cháy\s*khét/i,
      /bị\s*cháy/i,
      /đang\s*cháy/i,
      /rò\s*điện/i,
      /giật\s*điện/i,
      /chập\s*điện/i,
      /tia\s*lửa/i,
      /nẹt\s*lửa/i,
      /xẹt\s*lửa/i,
      /ổ\s*điện\s*nóng/i,
      /cầu\s*dao\s*nhảy/i,
      /aptomat\s*nhảy/i,
      /cb\s*nhảy/i,
    ];

    if (originalEmergencyPatterns.some((pattern) => pattern.test(originalLower))) {
      return true;
    }

    // Với text không dấu, không dùng "chay" hoặc "no" đơn lẻ.
    return this.includesAnyPhrase(expandedText, [
      'boc khoi',
      'co khoi',
      'mui khet',
      'chay khet',
      'bi chay',
      'dang chay',
      'ro dien',
      'giat dien',
      'chap dien',
      'tia lua',
      'net lua',
      'xet lua',
      'o dien nong',
      'cau dao nhay',
      'aptomat nhay',
      'cb nhay',
      'nuoc tran gan o dien',
    ]);
  }

  private inferSupportedDeviceCategory(
    expandedText: string,
  ): SupportedDeviceCategory {
    if (
      this.includesAnyPhrase(expandedText, [
        'may lanh',
        'dieu hoa',
        'cuc nong',
        'cuc lanh',
        'remote may lanh',
      ])
    ) {
      return 'AIR_CONDITIONER';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'may giat',
        'long giat',
        'khong vat',
        'khong xa',
        'khong cap nuoc',
      ])
    ) {
      return 'WASHING_MACHINE';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'tu lanh',
        'ngan dong',
        'ngan mat',
        'khong dong da',
      ])
    ) {
      return 'REFRIGERATOR';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'lo vi song',
        'lo nuong',
        'noi chien',
      ])
    ) {
      return 'MICROWAVE';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'o dien',
        'cong tac',
        'cau dao',
        'aptomat',
        'cb dien',
        'day dien',
        'ro dien',
        'chap dien',
      ])
    ) {
      return 'ELECTRICAL';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'may hut mui',
        'may rua chen',
        'binh nong lanh',
        'quat dien',
      ])
    ) {
      return 'OTHER_HOME_APPLIANCE';
    }

    return 'UNKNOWN';
  }

  private inferOutOfScopeDeviceCategory(
    expandedText: string,
  ): OutOfScopeDeviceCategory | null {
    if (
      this.includesAnyPhrase(expandedText, [
        'laptop',
        'latop',
        'notebook',
        'may tinh',
        'may tinh xach tay',
        'acer nitro',
        'ban phim laptop',
        'loi ban phim',
        'khong nhan phim',
        'liet phim',
      ])
    ) {
      return 'LAPTOP';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'dien thoai',
        'iphone',
        'samsung phone',
        'man hinh dien thoai',
      ])
    ) {
      return 'PHONE';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'may in',
        'printer',
        'ket giay',
      ])
    ) {
      return 'PRINTER';
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'pc',
        'may tinh ban',
        'case may tinh',
        'mainboard',
        'card man hinh',
      ])
    ) {
      return 'COMPUTER';
    }

    return null;
  }

  private isTechnicalSpecificIntent(input: {
    originalText: string;
    expandedText: string;
    supportedDeviceCategory: SupportedDeviceCategory;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
    detectedBrand: string | null;
    detectedErrorCode: string | null;
    detectedIssueLabel: string | null;
  }): boolean {
    const {
      expandedText,
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      detectedBrand,
      detectedErrorCode,
      detectedIssueLabel,
    } = input;

    if (detectedErrorCode) {
      return true;
    }

    const hasDevice =
      supportedDeviceCategory !== 'UNKNOWN' || outOfScopeDeviceCategory !== null;

    const hasSpecificQuestion = this.includesAnyPhrase(expandedText, [
      'sua sao',
      'cach sua',
      'xu ly sao',
      'khac phuc sao',
      'nguyen nhan',
      'do dau',
      'bao loi',
      'ma loi',
    ]);

    const hasSpecificIssue =
      detectedIssueLabel !== null ||
      this.includesAnyPhrase(expandedText, [
        'khong mat',
        'khong lanh',
        'khong chay',
        'khong len nguon',
        'khong vat',
        'khong xa',
        'khong cap nuoc',
        'chay nuoc',
        'keu to',
        'rung lac',
        'mat nguon',
        'liet phim',
        'khong nhan phim',
        'loi ban phim',
        'disconnect',
        'chap chon',
      ]);

    if (hasDevice && hasSpecificIssue) {
      return true;
    }

    if (hasDevice && hasSpecificQuestion) {
      return true;
    }

    if (detectedBrand && hasSpecificIssue) {
      return true;
    }

    return false;
  }

  private isTechnicalVagueIntent(input: {
    expandedText: string;
    supportedDeviceCategory: SupportedDeviceCategory;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
    detectedIssueLabel: string | null;
    isTechnicalSpecific: boolean;
  }): boolean {
    const {
      expandedText,
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      detectedIssueLabel,
      isTechnicalSpecific,
    } = input;

    if (isTechnicalSpecific) {
      return false;
    }

    const hasDevice =
      supportedDeviceCategory !== 'UNKNOWN' || outOfScopeDeviceCategory !== null;

    const hasVagueIssue = this.includesAnyPhrase(expandedText, [
      'bi hu',
      'hu roi',
      'bi loi',
      'loi roi',
      'khong on',
      'co van de',
      'sua sao',
      'fix sao',
      'no khong chay',
      'may bi loi',
      'may hu',
      'may khong chay',
      'keu la',
    ]);

    if (hasDevice && !detectedIssueLabel) {
      return true;
    }

    if (hasVagueIssue) {
      return true;
    }

    return false;
  }

  private inferBrand(expandedText: string): string | null {
    const brandMap: Array<[string, string]> = [
      ['toshiba', 'Toshiba'],
      ['panasonic', 'Panasonic'],
      ['daikin', 'Daikin'],
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
    ];

    for (const [keyword, label] of brandMap) {
      if (this.hasWholeWord(expandedText, keyword)) {
        return label;
      }
    }

    return null;
  }

  private inferErrorCode(
    originalText: string,
    expandedText: string,
  ): string | null {
    const originalMatch = originalText.match(/\b[A-Z]{1,3}\s?\d{1,3}\b/i);
    if (originalMatch?.[0]) {
      return originalMatch[0].replace(/\s+/g, '').toUpperCase();
    }

    const normalizedMatch = expandedText.match(/\b[a-z]{1,3}\s?\d{1,3}\b/i);
    if (normalizedMatch?.[0]) {
      return normalizedMatch[0].replace(/\s+/g, '').toUpperCase();
    }

    return null;
  }

  private inferIssueLabel(expandedText: string): string | null {
    const issueMap: Array<[string[], string]> = [
      [['khong mat', 'khong lanh'], 'Không mát/không lạnh'],
      [['khong chay', 'khong hoat dong'], 'Không chạy'],
      [['khong len nguon', 'mat nguon'], 'Không lên nguồn'],
      [['khong vat'], 'Không vắt'],
      [['khong xa', 'khong xa nuoc'], 'Không xả nước'],
      [['khong cap nuoc'], 'Không cấp nước'],
      [['chay nuoc', 'ri nuoc'], 'Chảy/rỉ nước'],
      [['keu to', 'keu la', 'on lon'], 'Kêu to/kêu lạ'],
      [['rung lac'], 'Rung lắc'],
      [['mui khet'], 'Có mùi khét'],
      [['boc khoi'], 'Bốc khói'],
      [['liet phim', 'ban phim liet'], 'Liệt phím'],
      [['khong nhan phim', 'loi ban phim', 'phim khong nhan'], 'Lỗi bàn phím'],
      [['disconnect', 'chap chon'], 'Chập chờn/disconnect'],
    ];

    for (const [keywords, label] of issueMap) {
      if (this.includesAnyPhrase(expandedText, keywords)) {
        return label;
      }
    }

    return null;
  }

  private inferDeviceLabel(
    supportedDeviceCategory: SupportedDeviceCategory,
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null,
  ): string | null {
    if (outOfScopeDeviceCategory === 'LAPTOP') {
      return 'Laptop';
    }

    if (outOfScopeDeviceCategory === 'PHONE') {
      return 'Điện thoại';
    }

    if (outOfScopeDeviceCategory === 'PRINTER') {
      return 'Máy in';
    }

    if (outOfScopeDeviceCategory === 'COMPUTER') {
      return 'Máy tính';
    }

    const labels: Record<SupportedDeviceCategory, string | null> = {
      AIR_CONDITIONER: 'Máy lạnh/điều hòa',
      WASHING_MACHINE: 'Máy giặt',
      REFRIGERATOR: 'Tủ lạnh',
      MICROWAVE: 'Lò vi sóng/lò nướng',
      ELECTRICAL: 'Thiết bị điện',
      OTHER_HOME_APPLIANCE: 'Thiết bị gia dụng',
      UNKNOWN: null,
    };

    return labels[supportedDeviceCategory];
  }

  private buildDirectResponse(input: {
    intent: AiIntentType;
    hasMojibakeSignal: boolean;
    detectedDeviceLabel: string | null;
    detectedIssueLabel: string | null;
    detectedBrand: string | null;
    detectedErrorCode: string | null;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
  }): string | null {
    const {
      intent,
      hasMojibakeSignal,
      detectedDeviceLabel,
      detectedIssueLabel,
      detectedBrand,
      detectedErrorCode,
      outOfScopeDeviceCategory,
    } = input;

    if (hasMojibakeSignal) {
      return [
        'Mình thấy nội dung bạn gửi có vẻ bị lỗi mã hóa tiếng Việt nên có thể hệ thống không hiểu chính xác.',
        'Bạn nhập lại ngắn gọn theo dạng “thiết bị + tình trạng lỗi” nhé, ví dụ: “máy lạnh không mát”, “máy giặt không vắt”, hoặc “ổ điện bốc khói”.',
      ].join(' ');
    }

    if (intent === 'GREETING') {
      return 'Chào bạn, mình là SmartElec Buddy. Bạn đang gặp vấn đề với thiết bị nào?';
    }

    if (intent === 'EMERGENCY') {
      return [
        'Cảnh báo an toàn: bạn hãy ngắt nguồn điện hoặc cầu dao ngay nếu còn an toàn để thao tác.',
        'Tuyệt đối không chạm tay trực tiếp vào khu vực đang bốc khói, có mùi khét, rò điện hoặc chập điện.',
        'Hãy giữ khoảng cách an toàn và gọi cứu hỏa hoặc điện lực nếu có nguy cơ cháy lan.',
        'Sau khi khu vực đã an toàn, bạn có thể đặt thợ để kiểm tra tại nhà.',
      ].join(' ');
    }

    if (intent === 'EXPLICIT_BOOKING') {
      const deviceText = detectedDeviceLabel
        ? ` ${detectedDeviceLabel.toLowerCase()}`
        : '';

      return [
        `Mình đã ghi nhận bạn muốn đặt thợ${deviceText}.`,
        'Bạn cho mình xin tình trạng lỗi, địa chỉ, số điện thoại và thời gian muốn thợ đến để mình hỗ trợ tạo yêu cầu nhé.',
      ].join(' ');
    }

    if (intent === 'OUT_OF_SCOPE_TECHNICAL') {
      if (outOfScopeDeviceCategory === 'LAPTOP') {
        return [
          `Mình hiểu bạn đang gặp vấn đề với ${detectedDeviceLabel?.toLowerCase() || 'laptop'}${detectedIssueLabel ? `, cụ thể là ${detectedIssueLabel.toLowerCase()}` : ''}.`,
          'SmartElec hiện không chuyên sửa laptop, nhưng mình vẫn có thể giúp bạn ghi nhận thông tin cho đủ và gợi ý hướng kiểm tra an toàn trước khi mang máy đi kiểm tra.',
          'Bạn cho mình thêm 3 ý ngắn nhé: model máy nếu có, cụm phím nào bị liệt hoặc không nhận, và lỗi xảy ra liên tục hay chỉ thỉnh thoảng.',
        ].join(' ');
      }

      return [
        'Hiện tại SmartElec chủ yếu hỗ trợ thiết bị điện gia dụng như máy lạnh, máy giặt, tủ lạnh và thiết bị điện trong nhà.',
        'Thiết bị bạn mô tả có vẻ nằm ngoài phạm vi hỗ trợ chính của hệ thống. Bạn có thể mô tả thêm, mình sẽ cố gợi ý sơ bộ hoặc hướng bạn tới nơi sửa phù hợp hơn.',
      ].join(' ');
    }

    if (intent === 'TECHNICAL_VAGUE') {
      const knownParts: string[] = [];

      if (detectedDeviceLabel) {
        knownParts.push(`thiết bị: ${detectedDeviceLabel}`);
      }

      if (detectedBrand) {
        knownParts.push(`thương hiệu: ${detectedBrand}`);
      }

      if (detectedErrorCode) {
        knownParts.push(`mã lỗi: ${detectedErrorCode}`);
      }

      if (detectedIssueLabel) {
        knownParts.push(`tình trạng: ${detectedIssueLabel}`);
      }

      const knownText =
        knownParts.length > 0
          ? `Mình đã ghi nhận ${knownParts.join(', ')}. `
          : '';

      return [
        knownText,
        'Bạn mô tả thêm giúp mình theo 3 ý ngắn: thiết bị là loại gì, lỗi cụ thể đang gặp là gì, và lỗi xảy ra liên tục hay chỉ thỉnh thoảng nhé.',
      ]
        .join('')
        .trim();
    }

    return null;
  }

  private includesAnyPhrase(text: string, phrases: string[]): boolean {
    return phrases.some((phrase) => text.includes(phrase));
  }

  private includesAnyKeyword(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => this.hasWholeWord(text, keyword));
  }

  private hasWholeWord(text: string, word: string): boolean {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
}
