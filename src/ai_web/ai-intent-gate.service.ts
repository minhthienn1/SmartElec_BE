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
  | 'COOLING_HEATING'
  | 'WATER_APPLIANCE'
  | 'COOKING_APPLIANCE'
  | 'DISPLAY_AUDIO'
  | 'CLEANING_APPLIANCE'
  | 'AIR_WATER_TREATMENT'
  | 'GENERIC_APPLIANCE'
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

type DeviceRule = {
  category: SupportedDeviceCategory;
  label: string;
  keywords: string[];
};

const SUPPORTED_WEB_DEVICE_KEYWORDS = new Set([
  'may lanh',
  'dieu hoa',
  'tu lanh',
  'cai tu',
  'tu dong',
  'may giat',
  'may rua bat',
  'may rua chen',
  'bep tu',
  'lo vi song',
  'microwave',
  'may suoi',
  'quat suoi',
  'den suoi',
]);

const DEVICE_RULES: DeviceRule[] = [
  { category: 'COOLING_HEATING', label: 'Điều hòa', keywords: ['may lanh', 'dieu hoa'] },
  { category: 'COOLING_HEATING', label: 'Tủ lạnh', keywords: ['tu lanh', 'cai tu', 'tu dong'] },
  { category: 'COOLING_HEATING', label: 'Máy nước nóng', keywords: ['may nuoc nong', 'binh nong lanh'] },
  { category: 'COOLING_HEATING', label: 'Máy sấy', keywords: ['may say', 'may say quan ao'] },
  { category: 'WATER_APPLIANCE', label: 'Máy giặt', keywords: ['may giat'] },
  { category: 'WATER_APPLIANCE', label: 'Máy rửa bát', keywords: ['may rua bat', 'may rua chen'] },
  { category: 'WATER_APPLIANCE', label: 'Máy lọc nước', keywords: ['may loc nuoc'] },
  { category: 'WATER_APPLIANCE', label: 'Máy bơm nước', keywords: ['may bom nuoc'] },
  { category: 'COOKING_APPLIANCE', label: 'Bếp từ', keywords: ['bep tu'] },
  { category: 'COOKING_APPLIANCE', label: 'Bếp điện', keywords: ['bep dien'] },
  { category: 'COOKING_APPLIANCE', label: 'Lò vi sóng', keywords: ['lo vi song', 'microwave'] },
  { category: 'COOKING_APPLIANCE', label: 'Lò nướng', keywords: ['lo nuong'] },
  { category: 'COOKING_APPLIANCE', label: 'Nồi chiên không dầu', keywords: ['noi chien khong dau', 'noi chien'] },
  { category: 'COOKING_APPLIANCE', label: 'Nồi cơm điện', keywords: ['noi com dien'] },
  { category: 'COOKING_APPLIANCE', label: 'Máy pha cà phê', keywords: ['may pha ca phe'] },
  { category: 'COOKING_APPLIANCE', label: 'Máy hút mùi', keywords: ['may hut mui'] },
  { category: 'DISPLAY_AUDIO', label: 'Tivi', keywords: ['tivi', 'tv'] },
  { category: 'DISPLAY_AUDIO', label: 'Màn hình', keywords: ['man hinh'] },
  { category: 'DISPLAY_AUDIO', label: 'Loa', keywords: ['loa'] },
  { category: 'DISPLAY_AUDIO', label: 'Amply', keywords: ['amply'] },
  { category: 'CLEANING_APPLIANCE', label: 'Robot hút bụi', keywords: ['robot hut bui'] },
  { category: 'CLEANING_APPLIANCE', label: 'Máy hút bụi', keywords: ['may hut bui'] },
  { category: 'CLEANING_APPLIANCE', label: 'Máy lau nhà', keywords: ['may lau nha'] },
  { category: 'AIR_WATER_TREATMENT', label: 'Máy lọc không khí', keywords: ['may loc khong khi'] },
  { category: 'AIR_WATER_TREATMENT', label: 'Máy hút ẩm', keywords: ['may hut am'] },
  { category: 'AIR_WATER_TREATMENT', label: 'Máy tạo ẩm', keywords: ['may tao am'] },
  { category: 'COOLING_HEATING', label: 'Máy sưởi', keywords: ['may suoi', 'quat suoi', 'den suoi'] },
];

@Injectable()
export class AiIntentGateService {
  analyze(message: string): AiIntentGateResult {
    const originalText = (message ?? '').trim();
    const normalizedText = this.normalizeIntentText(originalText);
    const expandedText = this.expandCommonAbbreviations(normalizedText);
    const hasMojibakeSignal = this.hasMojibakeSignal(originalText);
    const detectedRule = this.detectDeviceRule(expandedText);
    const supportedDeviceCategory = detectedRule?.category ?? 'UNKNOWN';
    const outOfScopeDeviceCategory =
      this.inferOutOfScopeDeviceCategory(expandedText);
    const unsupportedDeviceLabel =
      outOfScopeDeviceCategory === null && supportedDeviceCategory === 'UNKNOWN'
        ? this.inferUnsupportedDeviceLabel(expandedText)
        : null;
    const detectedDeviceLabel =
      detectedRule?.label ||
      unsupportedDeviceLabel ||
      this.inferDeviceLabelFromOutOfScope(outOfScopeDeviceCategory);
    const detectedBrand = this.inferBrand(expandedText);
    const detectedErrorCode = this.inferErrorCode(originalText, expandedText);
    const detectedIssueLabel = this.inferIssueLabel(expandedText);
    const isEmergency = this.isEmergencyIntent(originalText, expandedText);
    const isExplicitBooking = this.hasExplicitBookingPhrase(expandedText);
    const isServiceScopeQuestion = this.isServiceScopeQuestion(expandedText);
    const isOutOfScope =
      supportedDeviceCategory === 'UNKNOWN' &&
      (outOfScopeDeviceCategory !== null || unsupportedDeviceLabel !== null);

    const isTechnicalSpecific = this.isTechnicalSpecificIntent({
      expandedText,
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      unsupportedDeviceLabel,
      detectedErrorCode,
      detectedIssueLabel,
    });

    const isTechnicalVague = this.isTechnicalVagueIntent({
      supportedDeviceCategory,
      outOfScopeDeviceCategory,
      unsupportedDeviceLabel,
      detectedIssueLabel,
      isTechnicalSpecific,
      expandedText,
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

    if (isServiceScopeQuestion) {
      reasons.push('MATCHED_SERVICE_SCOPE_QUESTION');
    } else if (isEmergency) {
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
      detectedDeviceLabel: detectedDeviceLabel || null,
      detectedIssueLabel,
      detectedBrand,
      detectedErrorCode,
      shouldUseRag: intent === 'TECHNICAL_SPECIFIC',
      shouldAskClarification: intent === 'TECHNICAL_VAGUE',
      shouldReturnDirectResponse:
        isServiceScopeQuestion ||
        intent === 'GREETING' ||
        intent === 'EMERGENCY' ||
        intent === 'EXPLICIT_BOOKING' ||
        intent === 'OUT_OF_SCOPE_TECHNICAL' ||
        hasMojibakeSignal,
      directResponse: this.buildDirectResponse({
        intent,
        isServiceScopeQuestion,
        hasMojibakeSignal,
        detectedDeviceLabel,
        detectedIssueLabel,
        detectedBrand,
        detectedErrorCode,
        outOfScopeDeviceCategory,
      }),
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
      [/\bhnay\b/g, ' hom nay '],
      [/\btmai\b/g, ' ngay mai '],
      [/\bml\s+(khong|mat|lanh|chay|hu|loi|sua)\b/g, ' may lanh $1'],
      [/\bmg\s+(khong|vat|xa|chay|hu|loi|sua)\b/g, ' may giat $1'],
    ];

    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }

    return text.replace(/\s+/g, ' ').trim();
  }

  private hasMojibakeSignal(originalText: string): boolean {
    return [/Ãƒ./, /Ã‚./, /Ã¡Âº./, /Ã¡Â»./, /ï¿½/, /�/].some((pattern) =>
      pattern.test(originalText),
    );
  }

  private detectDeviceRule(expandedText: string) {
    return DEVICE_RULES.find((rule) =>
      this.isSupportedWebDeviceRule(rule) &&
      rule.keywords.some((keyword) => this.hasWholeWord(expandedText, keyword)),
    );
  }

  private isSupportedWebDeviceRule(rule: DeviceRule): boolean {
    return rule.keywords.some((keyword) => SUPPORTED_WEB_DEVICE_KEYWORDS.has(keyword));
  }

  private isGreetingIntent(
    expandedText: string,
    hasProblemContext: boolean,
  ): boolean {
    if (hasProblemContext) {
      return false;
    }

    return [/^xin chao$/, /^chao$/, /^hello$/, /^hi$/, /^alo$/].some((pattern) =>
      pattern.test(expandedText),
    );
  }

  private hasExplicitBookingPhrase(expandedText: string): boolean {
    return this.includesAnyPhrase(expandedText, [
      'dat tho',
      'goi tho',
      'can tho',
      'dat lich',
      'toi muon dat tho',
      'toi can dat tho',
    ]);
  }

  private isServiceScopeQuestion(expandedText: string): boolean {
    return this.includesAnyPhrase(expandedText, [
      'sua chua thiet bi gi',
      'sua duoc thiet bi gi',
      'ho tro thiet bi gi',
      'ben ban sua gi',
      'ben ban sua chua gi',
      'website sua chua gi',
      'co huong dan lam',
    ]);
  }

  private isEmergencyIntent(originalText: string, expandedText: string): boolean {
    const originalLower = originalText.toLowerCase();
    const originalEmergencyPatterns = [
      /bốc\s*khói/i,
      /có\s*khói/i,
      /mùi\s*khét/i,
      /cháy\s*khét/i,
      /rò\s*điện/i,
      /giật\s*điện/i,
      /chập\s*điện/i,
      /tia\s*lửa/i,
      /aptomat\s*nhảy/i,
    ];

    if (originalEmergencyPatterns.some((pattern) => pattern.test(originalLower))) {
      return true;
    }

    return this.includesAnyPhrase(expandedText, [
      'boc khoi',
      'co khoi',
      'mui khet',
      'ro dien',
      'giat dien',
      'chap dien',
      'tia lua',
      'aptomat nhay',
      'nuoc tran gan o dien',
    ]);
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
    if (this.includesAnyPhrase(expandedText, ['dien thoai', 'iphone'])) {
      return 'PHONE';
    }
    if (this.includesAnyPhrase(expandedText, ['may in', 'printer'])) {
      return 'PRINTER';
    }
    if (this.includesAnyPhrase(expandedText, ['pc', 'may tinh ban', 'mainboard'])) {
      return 'COMPUTER';
    }
    return null;
  }

  private isTechnicalSpecificIntent(input: {
    expandedText: string;
    supportedDeviceCategory: SupportedDeviceCategory;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
    unsupportedDeviceLabel: string | null;
    detectedErrorCode: string | null;
    detectedIssueLabel: string | null;
  }): boolean {
    if (input.detectedErrorCode) {
      return true;
    }

    const hasDevice =
      input.supportedDeviceCategory !== 'UNKNOWN' ||
      input.outOfScopeDeviceCategory !== null ||
      Boolean(input.unsupportedDeviceLabel);

    if (hasDevice && input.detectedIssueLabel) {
      return true;
    }

    const hasSpecificIssue = this.includesAnyPhrase(input.expandedText, [
      'khong mat',
      'khong lam mat',
      'phong ham ham',
      'chang thay mat',
      'khong lanh',
      'khong lam nong',
      'khong lam nong thuc an',
      'do an van nguoi',
      'quay xong van nguoi',
      'khong chay',
      'khong len nguon',
      'khong vat',
      'do con sung nuoc',
      'quan ao con uot',
      'do con uot',
      'khong suoi',
      'khong am',
      'chi pha gio',
      'pha gio nhe',
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

    return (
      hasDevice &&
      this.includesAnyPhrase(input.expandedText, [
        'sua sao',
        'cach sua',
        'xu ly sao',
        'khac phuc sao',
        'nguyen nhan',
        'do dau',
        'bao loi',
        'ma loi',
      ])
    );
  }

  private isTechnicalVagueIntent(input: {
    supportedDeviceCategory: SupportedDeviceCategory;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
    unsupportedDeviceLabel: string | null;
    detectedIssueLabel: string | null;
    isTechnicalSpecific: boolean;
    expandedText: string;
  }): boolean {
    if (input.isTechnicalSpecific) {
      return false;
    }

    const hasDevice =
      input.supportedDeviceCategory !== 'UNKNOWN' ||
      input.outOfScopeDeviceCategory !== null ||
      Boolean(input.unsupportedDeviceLabel);

    if (!hasDevice && input.detectedIssueLabel) {
      return true;
    }

    if (hasDevice && !input.detectedIssueLabel) {
      return true;
    }

    return this.includesAnyPhrase(input.expandedText, [
      'bi hu',
      'hu roi',
      'bi loi',
      'co van de',
      'keu la',
      'thiet bi nha tui loi',
      'cai may co van de',
    ]);
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

  private inferErrorCode(originalText: string, expandedText: string): string | null {
    const originalMatch = originalText.match(/\b[A-Z]{1,3}\s?\d{1,3}\b/i);
    if (originalMatch?.[0]) {
      return originalMatch[0].replace(/\s+/g, '').toUpperCase();
    }

    const normalizedMatch = expandedText.match(/\b[a-z]{1,3}\s?\d{1,3}\b/i);
    return normalizedMatch?.[0]
      ? normalizedMatch[0].replace(/\s+/g, '').toUpperCase()
      : null;
  }

  private inferIssueLabel(expandedText: string): string | null {
    const emergencyIssueMap: Array<[string[], string]> = [
      [['mui khet', 'chay khet', 'bi chay', 'dang chay'], 'Có mùi khét / cháy'],
      [['boc khoi', 'co khoi'], 'Bốc khói'],
      [['tia lua', 'chap dien', 'ro dien', 'giat dien', 'net lua', 'xet lua'], 'Có tia lửa / chập điện'],
      [['nong bat thuong', 'qua nong', 'o dien nong'], 'Nóng bất thường'],
      [['ro gas', 'ro nuoc'], 'Rò rỉ nguy hiểm'],
    ];

    for (const [keywords, label] of emergencyIssueMap) {
      if (this.includesAnyPhrase(expandedText, keywords)) {
        return label;
      }
    }

    if (
      this.includesAnyPhrase(expandedText, [
        'khong suoi',
        'khong am',
        'chi pha gio',
        'pha gio nhe',
      ])
    ) {
      return 'Không sưởi được';
    }

    const issueMap: Array<[string[], string]> = [
      [['khong lanh', 'khong mat', 'bi lanh'], 'Không lạnh'],
      [['khong nong'], 'Không nóng'],
      [['khong dong da'], 'Không đông đá'],
      [['khong xa nuoc', 'khong xa'], 'Không xả nước'],
      [['khong cap nuoc'], 'Không cấp nước'],
      [['khong vat', 'do con sung nuoc', 'quan ao con uot', 'do con uot'], 'Không vắt'],
      [['khong len nguon', 'mat nguon'], 'Không lên nguồn'],
      [['khong chay', 'khong hoat dong'], 'Không chạy'],
      [['hut yeu'], 'Hút yếu'],
      [['bao den do', 'den do'], 'Báo đèn đỏ'],
      [['ri nuoc', 'ro nuoc', 'chay nuoc'], 'Rò nước'],
      [['mui khet'], 'Có mùi khét'],
      [['boc khoi'], 'Bốc khói'],
      [['liet phim', 'ban phim liet'], 'Liệt phím'],
      [['khong nhan phim', 'loi ban phim', 'phim khong nhan'], 'Lỗi bàn phím'],
      [['disconnect', 'chap chon'], 'Chập chờn/disconnect'],
      [['bi hu', 'hu roi'], 'Bị hư'],
    ];

    for (const [keywords, label] of issueMap) {
      if (this.includesAnyPhrase(expandedText, keywords)) {
        return label;
      }
    }

    return null;
  }

  private inferDeviceLabelFromOutOfScope(
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null,
  ) {
    if (outOfScopeDeviceCategory === 'LAPTOP') return 'Laptop';
    if (outOfScopeDeviceCategory === 'PHONE') return 'Điện thoại';
    if (outOfScopeDeviceCategory === 'PRINTER') return 'Máy in';
    if (outOfScopeDeviceCategory === 'COMPUTER') return 'Máy tính';
    return null;
  }

  private inferUnsupportedDeviceLabelLegacy(expandedText: string): string | null {
    const unsupportedDeviceMap: Array<[string[], string]> = [
      [['may quat', 'quat dien', 'quat may', 'quat ban', 'quat dung', 'quat treo'], 'Máy quạt'],
      [['may say toc', 'may uon toc', 'may ep toc'], 'Máy chăm sóc tóc'],
      [['quat dieu hoa', 'may lam mat mini'], 'Thiết bị làm mát mini'],
      [['xe may', 'xe moto'], 'Xe máy'],
      [['xe dap', 'xe dap dien'], 'Xe đạp'],
    ];

    for (const [keywords, label] of unsupportedDeviceMap) {
      if (this.includesAnyPhrase(expandedText, keywords)) {
        return label;
      }
    }

    return null;
  }

  private inferUnsupportedDeviceLabel(expandedText: string): string | null {
    const legacyLabel = this.inferUnsupportedDeviceLabelLegacy(expandedText);
    if (legacyLabel) {
      return legacyLabel;
    }

    const pattern =
      /\b((?:may|quat|noi|lo|bep|tu|robot|binh|den|loa|amply|tivi|tv|man hinh|xe)\s+[a-z0-9]+(?:\s+[a-z0-9]+){0,2})\b/i;
    const match = expandedText.match(pattern);

    if (!match?.[1]) {
      return null;
    }

    const phrase = this.trimUnsupportedDevicePhrase(match[1]);
    if (!phrase) {
      return null;
    }

    return this.toDisplayDeviceLabel(phrase);
  }

  private trimUnsupportedDevicePhrase(value: string): string | null {
    const stopWords = new Set([
      'bi',
      'loi',
      'hu',
      'roi',
      'co',
      'van',
      'de',
      'khong',
      'hong',
      'can',
      'sua',
      'huong',
      'dan',
      'nha',
      'tui',
      'minh',
      'dang',
      'gap',
      'voi',
      'ben',
      'ban',
      'thi',
      'sao',
      'nao',
      'vay',
      'ko',
      'duoc',
    ]);

    const tokens = value
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const kept: string[] = [];
    for (const token of tokens) {
      if (kept.length > 0 && stopWords.has(token)) {
        break;
      }
      kept.push(token);
    }

    return kept.length > 1 ? kept.join(' ') : null;
  }

  private toDisplayDeviceLabel(value: string): string {
    return value
      .split(/\s+/)
      .map((token) =>
        token.length > 0 ? `${token.charAt(0).toUpperCase()}${token.slice(1)}` : token,
      )
      .join(' ');
  }

  private buildDirectResponse(input: {
    intent: AiIntentType;
    isServiceScopeQuestion?: boolean;
    hasMojibakeSignal: boolean;
    detectedDeviceLabel: string | null;
    detectedIssueLabel: string | null;
    detectedBrand: string | null;
    detectedErrorCode: string | null;
    outOfScopeDeviceCategory: OutOfScopeDeviceCategory | null;
  }): string | null {
    if (input.hasMojibakeSignal) {
      return 'Mình thấy nội dung bạn gửi có vẻ bị lỗi mã hóa tiếng Việt. Bạn nhập lại ngắn gọn theo dạng “thiết bị + tình trạng lỗi” nhé.';
    }

    if (input.isServiceScopeQuestion) {
      return [
        'Hien tai chatbot web SmartElec ho tro tu van cho cac thiet bi noi bo gom may lanh, may giat, tu lanh, lo vi song, may rua bat, bep tu va may suoi.',
        'Neu thiet bi cua ban nam ngoai danh sach nay, minh se bao ro la website chua ho tro thay vi chan doan ben ngoai nghiep vu.',
        'Ban cu nhan theo dang "thiet bi + tinh trang loi", vi du: "may lanh khong lanh" hoac "may giat khong vat".',
      ].join(' ');
    }

    if (input.intent === 'GREETING') {
      return 'Chào bạn, mình là SmartElec Buddy. Bạn đang gặp vấn đề với thiết bị nào?';
    }

    if (input.intent === 'EMERGENCY') {
      return 'Cảnh báo an toàn: bạn hãy ngắt nguồn điện ngay nếu còn an toàn để thao tác, không chạm tay trực tiếp vào khu vực đang có khói, mùi khét hoặc rò điện.';
    }

    if (input.intent === 'EXPLICIT_BOOKING') {
      return 'Mình đã ghi nhận bạn muốn đặt thợ. Bạn cho mình xin tình trạng lỗi, địa chỉ, số điện thoại và thời gian mong muốn để mình hỗ trợ tạo yêu cầu nhé.';
    }

    if (
      input.intent === 'OUT_OF_SCOPE_TECHNICAL' &&
      input.outOfScopeDeviceCategory !== 'LAPTOP'
    ) {
      return [
        input.detectedDeviceLabel
          ? `Hiện tại SmartElec chưa hỗ trợ tư vấn sửa chữa cho ${input.detectedDeviceLabel.toLowerCase()} trên website này.`
          : 'Hiện tại SmartElec chưa hỗ trợ tư vấn cho thiết bị bạn vừa mô tả trên website này.',
        'Bên mình hiện tập trung vào các thiết bị điện gia dụng như máy lạnh, máy giặt, tủ lạnh, lò vi sóng, máy nước nóng và một số thiết bị trong nhà khác.',
        'Bạn có thể đổi sang thiết bị nằm trong danh mục hỗ trợ, hoặc nếu cần mình có thể gợi ý hướng kiểm tra sơ bộ phù hợp hơn.',
      ].join(' ');
    }

    if (input.intent === 'OUT_OF_SCOPE_TECHNICAL') {
      if (input.outOfScopeDeviceCategory === 'LAPTOP') {
        return [
          `Mình hiểu bạn đang gặp vấn đề với ${input.detectedDeviceLabel?.toLowerCase() || 'laptop'}${input.detectedIssueLabel ? `, cụ thể là ${input.detectedIssueLabel.toLowerCase()}` : ''}.`,
          'SmartElec hiện không chuyên sửa laptop, nhưng mình vẫn có thể giúp bạn ghi nhận thông tin cho đủ và gợi ý hướng kiểm tra an toàn trước khi mang máy đi kiểm tra.',
          'Bạn cho mình thêm 3 ý ngắn nhé: model máy nếu có, cụm phím nào bị liệt hoặc không nhận, và lỗi xảy ra liên tục hay chỉ thỉnh thoảng.',
        ].join(' ');
      }

      return [
        'Hiện tại SmartElec chủ yếu hỗ trợ thiết bị điện gia dụng như máy lạnh, máy giặt, tủ lạnh và thiết bị điện trong nhà.',
        'Thiết bị bạn mô tả có vẻ nằm ngoài phạm vi hỗ trợ chính của hệ thống. Bạn có thể mô tả thêm, mình sẽ cố gợi ý sơ bộ hoặc hướng bạn tới nơi sửa phù hợp hơn.',
      ].join(' ');
    }

    if (input.intent === 'TECHNICAL_VAGUE') {
      const knownParts: string[] = [];

      if (input.detectedDeviceLabel) {
        knownParts.push(`thiết bị: ${input.detectedDeviceLabel}`);
      }

      if (input.detectedBrand) {
        knownParts.push(`thương hiệu: ${input.detectedBrand}`);
      }

      if (input.detectedErrorCode) {
        knownParts.push(`mã lỗi: ${input.detectedErrorCode}`);
      }

      if (input.detectedIssueLabel) {
        knownParts.push(`tình trạng: ${input.detectedIssueLabel}`);
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

  private hasWholeWord(text: string, word: string): boolean {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
}
