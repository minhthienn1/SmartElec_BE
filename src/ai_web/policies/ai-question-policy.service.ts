import { Injectable } from '@nestjs/common';
import type { ContextAnswerKey } from '../extraction/ai-context-collector.service';
import type { DeviceCategory } from '../orchestration/ai-guided-diagnosis.service';

export type QuestionTemplate = {
  intro: string;
  questions: string[];
  followups: Partial<Record<ContextAnswerKey, string>>;
};

@Injectable()
export class AiQuestionPolicyService {
  // Tạo khóa ổn định để nhận biết đúng bộ câu hỏi đã hỏi trong phiên.
  buildQuestionSet(device: string, category: DeviceCategory, symptom: string | null): string {
    const normalizedDevice = this.normalize(device);
    const normalizedSymptom = this.normalize(symptom ?? '');
    if (category === 'COOLING_HEATING' && /dieu hoa|may lanh/u.test(normalizedDevice) && /khong lanh|khong mat/u.test(normalizedSymptom)) {
      return 'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL';
    }
    if (category === 'COOLING_HEATING' && /tu lanh|tu dong/u.test(normalizedDevice)) {
      return 'COOLING_HEATING::REFRIGERATOR_COOLING';
    }
    return `${category}::GENERIC`;
  }

  // Trả bộ ba câu hỏi và follow-up deterministic theo category/symptom.
  getTemplate(questionSet: string): QuestionTemplate {
    const templates: Record<string, QuestionTemplate> = {
      'COOLING_HEATING::AIR_CONDITIONER_NOT_COOL': {
        intro: 'Mình cần 3 thông tin để chẩn đoán sát hơn:',
        questions: ['Dàn lạnh trong phòng có thổi gió không?', 'Cục nóng bên ngoài có chạy không?', 'Máy có báo mã lỗi/chớp đèn, hoặc gần đây có vệ sinh/bơm gas chưa?'],
        followups: { outdoorUnitStatus: 'cục nóng bên ngoài có chạy không? Thông tin này rất quan trọng để phân biệt lỗi gas, quạt/block dàn nóng hay board điều khiển.', errorCode: 'Máy có báo mã lỗi, chớp đèn hoặc gần đây đã vệ sinh/bơm gas chưa?' },
      },
      'COOLING_HEATING::REFRIGERATOR_COOLING': {
        intro: 'Mình cần 3 thông tin để kiểm tra đúng lỗi:',
        questions: ['Ngăn mát hay ngăn đá đang không lạnh/không đông?', 'Block/máy nén phía sau có chạy và nóng không?', 'Ron cửa có hở, quạt có chạy, hoặc tủ có đóng tuyết bất thường không?'],
        followups: { operationStatus: 'Hiện ngăn mát hay ngăn đá đang mất lạnh rõ hơn?', abnormalSigns: 'Tủ có đóng tuyết bất thường, quạt yếu hoặc ron cửa hở không?' },
      },
      'WATER_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: ['Thiết bị đang lỗi ở bước nào: cấp nước, hoạt động chính, xả nước hay không lên nguồn?', 'Có mã lỗi, đèn nhấp nháy, tiếng lạ, mùi khét, rò nước hoặc nước không thoát không?', 'Lỗi xảy ra liên tục hay lúc có lúc không, và có xuất hiện sau khi vệ sinh/thay lõi/di chuyển máy không?'],
        followups: { operationStatus: 'Thiết bị đang lỗi rõ nhất ở bước nào: cấp nước, chạy chính hay xả nước?', errorCode: 'Thiết bị có mã lỗi hoặc đèn nhấp nháy nào không?' },
      },
      'COOKING_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để kiểm tra an toàn hơn:',
        questions: ['Thiết bị có lên nguồn/hiển thị bình thường không?', 'Khi hoạt động có nóng/đun/nướng đúng chức năng không, hay bị yếu/tự ngắt?', 'Có mã lỗi, tiếng lạ, mùi khét, tia lửa, khói hoặc tự ngắt bất thường không?'],
        followups: { operationStatus: 'Thiết bị có lên nguồn nhưng không nóng, hay không lên nguồn hoàn toàn?', safetySigns: 'Có mùi khét, khói hoặc tia lửa khi vận hành không?' },
      },
      'DISPLAY_AUDIO::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: ['Thiết bị có lên nguồn/đèn báo không?', 'Lỗi nằm ở hình ảnh, âm thanh, kết nối hay nguồn điện?', 'Lỗi xảy ra sau va đập, sét, mất điện, cập nhật phần mềm hay đang dùng bình thường?'],
        followups: { operationStatus: 'Thiết bị hiện còn lên nguồn hay hoàn toàn không có đèn báo?', whenHappens: 'Lỗi bắt đầu sau sự kiện nào gần đây như mất điện, va đập hoặc cập nhật?' },
      },
      'CLEANING_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: ['Thiết bị có lên nguồn và motor/bánh xe/chổi quay còn hoạt động không?', 'Lỗi là hút yếu, không chạy, kẹt bánh/chổi, báo lỗi cảm biến hay pin sạc không vào?', 'Có tiếng lạ, mùi khét, bụi/nước rò ra hoặc lỗi xảy ra sau khi vệ sinh máy không?'],
        followups: { operationStatus: 'Máy hiện không chạy hoàn toàn hay vẫn chạy nhưng hút yếu?', abnormalSigns: 'Có tiếng lạ, mùi khét hoặc kẹt chổi/bánh xe không?' },
      },
      'AIR_WATER_TREATMENT::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi:',
        questions: ['Thiết bị có lên nguồn và quạt/bơm/cảm biến còn hoạt động không?', 'Có mã lỗi, đèn báo thay lõi/thay màng lọc, tiếng lạ hoặc mùi bất thường không?', 'Lỗi xảy ra sau khi thay lõi, vệ sinh, di chuyển máy hay dùng bình thường?'],
        followups: { errorCode: 'Thiết bị có đèn báo đỏ, báo thay lõi hoặc mã lỗi nào không?', whenHappens: 'Lỗi xuất hiện sau lần thay lõi/vệ sinh gần nhất hay đang dùng bình thường?' },
      },
      'GENERIC_APPLIANCE::GENERIC': {
        intro: 'Mình cần 3 thông tin để khoanh vùng lỗi chính xác hơn:',
        questions: ['Thiết bị còn lên nguồn/chạy được phần nào không?', 'Có mã lỗi, đèn nhấp nháy, tiếng lạ, mùi khét, rò nước hoặc dấu hiệu bất thường nào không?', 'Lỗi bắt đầu từ khi nào, xảy ra liên tục hay lúc có lúc không?'],
        followups: { operationStatus: 'Thiết bị hiện còn lên nguồn hoặc hoạt động được phần nào không?', errorCode: 'Có mã lỗi, đèn nhấp nháy, tiếng lạ, mùi khét hoặc dấu hiệu bất thường nào rõ hơn không?', whenHappens: 'Lỗi bắt đầu từ khi nào và có xảy ra liên tục không?' },
      },
    };
    return templates[questionSet] || templates['GENERIC_APPLIANCE::GENERIC'];
  }

  // Ghép template thành nội dung ba câu hỏi context hiển thị cho người dùng.
  buildQuestionSetMessage(questionSet: string): string {
    const template = this.getTemplate(questionSet);
    return [template.intro, '', `1. ${template.questions[0]}`, `2. ${template.questions[1]}`, `3. ${template.questions[2]}`].join('\n');
  }

  // Hỏi triệu chứng cụ thể khi đã biết thiết bị nhưng mô tả lỗi còn quá chung.
  buildMissingSymptomPrompt(device: string, category: DeviceCategory | null): string {
    const examples = this.getSymptomExamples(category);
    return [`Mình đã ghi nhận thiết bị là ${device}.`, 'Nhưng mình chưa hiểu rõ lỗi cụ thể đang gặp là gì.', examples ? `Bạn mô tả theo kiểu gần nhất giúp mình, ví dụ: ${examples}.` : 'Bạn mô tả rõ hơn giúp mình hiện tượng đang gặp là gì nhé.'].join(' ');
  }

  // Diễn đạt lại yêu cầu khi câu trả lời trước chưa cung cấp context cần thiết.
  buildRetryFollowupPrompt(question: string): string {
    return `Mình chưa đọc ra rõ ý bạn ở chi tiết này. Bạn trả lời giúp mình rõ hơn: ${question}`;
  }

  private getSymptomExamples(category: DeviceCategory | null): string | null {
    const examples: Partial<Record<DeviceCategory, string>> = {
      COOLING_HEATING: 'không lạnh, không nóng, kêu to, rò nước hoặc có mùi khét',
      WATER_APPLIANCE: 'không cấp nước, không xả nước, không vắt, rò nước hoặc không lên nguồn',
      COOKING_APPLIANCE: 'không nóng, không lên nguồn, báo lỗi, có mùi khét hoặc chạy yếu',
      DISPLAY_AUDIO: 'không lên hình, không có tiếng, sọc màn, nhấp nháy hoặc mất kết nối',
      CLEANING_APPLIANCE: 'hút yếu, không chạy, pin không sạc, kẹt bàn chải hoặc báo lỗi',
      AIR_WATER_TREATMENT: 'không lọc, không phun sương, cháy mùi, rò nước hoặc báo lỗi',
    };
    return category ? examples[category] ?? null : null;
  }

  private normalize(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  }
}
