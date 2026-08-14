import { Injectable } from '@nestjs/common';

export type WebDeviceCategory =
  | 'COOLING_HEATING'
  | 'WATER_APPLIANCE'
  | 'COOKING_APPLIANCE';

export type WebDeviceDefinition = {
  key: string;
  category: WebDeviceCategory;
  label: string;
  promptLabel: string;
  aliases: string[];
};

const WEB_DEVICE_CATALOG: WebDeviceDefinition[] = [
  {
    key: 'air_conditioner',
    category: 'COOLING_HEATING',
    label: 'Điều hòa',
    promptLabel: 'máy lạnh',
    aliases: ['máy lạnh', 'may lanh', 'điều hòa', 'dieu hoa'],
  },
  {
    key: 'washing_machine',
    category: 'WATER_APPLIANCE',
    label: 'Máy giặt',
    promptLabel: 'máy giặt',
    aliases: ['máy giặt', 'may giat'],
  },
  {
    key: 'refrigerator',
    category: 'COOLING_HEATING',
    label: 'Tủ lạnh',
    promptLabel: 'tủ lạnh',
    aliases: ['tủ lạnh', 'tu lanh', 'cái tủ', 'cai tu', 'tủ đông', 'tu dong'],
  },
  {
    key: 'microwave',
    category: 'COOKING_APPLIANCE',
    label: 'Lò vi sóng',
    promptLabel: 'lò vi sóng',
    aliases: ['lò vi sóng', 'lo vi song', 'microwave'],
  },
  {
    key: 'dishwasher',
    category: 'WATER_APPLIANCE',
    label: 'Máy rửa bát',
    promptLabel: 'máy rửa bát',
    aliases: ['máy rửa bát', 'may rua bat', 'máy rửa chén', 'may rua chen'],
  },
  {
    key: 'induction_cooker',
    category: 'COOKING_APPLIANCE',
    label: 'Bếp từ',
    promptLabel: 'bếp từ',
    aliases: ['bếp từ', 'bep tu'],
  },
  {
    key: 'heater',
    category: 'COOLING_HEATING',
    label: 'Máy sưởi',
    promptLabel: 'máy sưởi',
    aliases: ['máy sưởi', 'may suoi', 'quạt sưởi', 'quat suoi', 'đèn sưởi', 'den suoi'],
  },
];

@Injectable()
export class AiWebDeviceCatalogService {
  // Trả về thiết bị canonical chỉ khi giá trị khớp alias thuộc phạm vi chatbot web.
  resolve(value: unknown): WebDeviceDefinition | null {
    const normalized = this.normalize(value);
    if (!normalized) {
      return null;
    }

    return (
      WEB_DEVICE_CATALOG.find((device) =>
        device.aliases.some((alias) => {
          const normalizedAlias = this.normalize(alias);
          return normalized === normalizedAlias || normalized.includes(normalizedAlias);
        }),
      ) ?? null
    );
  }

  // Thu thập mỗi thiết bị canonical tối đa một lần dù câu chứa nhiều alias đồng nghĩa.
  collectMentions(text: string): WebDeviceDefinition[] {
    const normalized = this.normalize(text);
    if (!normalized) {
      return [];
    }

    return WEB_DEVICE_CATALOG.filter((device) =>
      device.aliases.some((alias) =>
        this.hasPhrase(normalized, this.normalize(alias)),
      ),
    );
  }

  // Đếm số thiết bị khác nhau để nhận biết câu đang nói về nhiều thiết bị.
  countMentions(text: string): number {
    return this.collectMentions(text).length;
  }

  // Chuẩn hóa alias canonical phục vụ so sánh device switch giữa các lượt chat.
  normalizeKey(value: unknown): string {
    return this.resolve(value)?.key ?? this.normalize(value);
  }

  private normalize(value: unknown): string {
    return (typeof value === 'string' ? value : '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasPhrase(text: string, phrase: string): boolean {
    return new RegExp(`(^|\\s)${this.escapeRegExp(phrase)}(?=\\s|$)`, 'u').test(text);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
