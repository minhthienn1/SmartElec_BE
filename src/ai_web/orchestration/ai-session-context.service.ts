import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type PlainState = Record<string, any>;
type SessionContext = {
  deviceType?: string | null;
  symptom?: string | null;
  aiSummary?: string | null;
};

@Injectable()
export class AiSessionContextService {
  constructor(private readonly prisma: PrismaService) {}

  // Đọc metadata phiên để kiểm tra trạng thái và bổ sung context còn thiếu.
  async getSessionContext(sessionId: number | null) {
    if (!sessionId) return null;
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        deviceType: true,
        symptom: true,
        aiSummary: true,
      },
    });
  }

  // Tạo ngữ cảnh các thiết bị khách hàng đã đăng ký cho prompt cuối.
  async buildDeviceContext(userId: number): Promise<string> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      select: { category: true, brandName: true, modelCode: true },
    });
    if (devices.length === 0) return '';
    return `\n[THÔNG TIN THIẾT BỊ KHÁCH HÀNG]: ${devices.map((device) => {
      const brand = device.brandName?.trim() || 'Không rõ hãng';
      const category = device.category?.trim() || 'Thiết bị';
      const model = device.modelCode?.trim() ? ` (${device.modelCode.trim()})` : '';
      return `${brand} ${category}${model}`;
    }).join(', ')}`;
  }

  // Chuyển conversation state gần nhất thành context gửi cho Gemini.
  buildLastStateContext(prevState: PlainState | null): string {
    if (!prevState) {
      return '\n[TRẠNG THÁI HIỆN TẠI]: Phiên chat mới, chưa có trạng thái trước đó.';
    }
    return `\n[TRẠNG THÁI HIỆN TẠI]: ${JSON.stringify(prevState)}`;
  }

  // Seed dữ liệu từ ChatSession nhưng không ghi đè state đã có của cuộc hội thoại.
  seedPreviousState(
    prevStateValue: PlainState | null,
    sessionContext: SessionContext | null,
  ): PlainState {
    const prevState = prevStateValue ? { ...prevStateValue } : {};
    if (!this.clean(prevState.device) && this.clean(sessionContext?.deviceType)) {
      prevState.device = sessionContext?.deviceType?.trim();
    }
    if (!this.clean(prevState.symptom) && this.clean(sessionContext?.symptom)) {
      prevState.symptom = sessionContext?.symptom?.trim();
    }
    if (!this.clean(prevState.aiSummaryText) && this.clean(sessionContext?.aiSummary)) {
      prevState.aiSummaryText = sessionContext?.aiSummary?.trim();
    }
    return prevState;
  }

  private clean(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
