import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AiService } from './src/ai/ai.service';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  console.log('🚀 Khởi tạo ứng dụng NestJS Standalone để Test RLHF...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const aiService = app.get(AiService);
  const prisma = app.get(PrismaService);

  // Tạo một User Test tạm thời nếu chưa có
  let testUser = await prisma.user.findFirst({ where: { email: 'test_rlhf@smartelec.com' } });
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        email: 'test_rlhf@smartelec.com',
        password: 'dummy',
        fullName: 'Test RLHF User',
        phoneNumber: '0999888777',
        gender: 'MALE',
        role: 'USER',
      },
    });
  }
  const userId = testUser.id;

  // Tạo một Thiết bị Test tạm thời (Máy lạnh)
  let testDevice = await prisma.device.findFirst({ where: { userId, category: 'Máy lạnh' } });
  if (!testDevice) {
    testDevice = await prisma.device.create({
      data: {
        userId,
        category: 'Máy lạnh',
        brandName: 'Panasonic',
      },
    });
  }

  console.log('\n==================================================');
  console.log('🟢 BƯỚC 1: TẠO "GOLDEN EXAMPLE" (MỒI ĐIỂM CAO)');
  console.log('==================================================');
  
  // Khách: Máy lạnh nhà tôi bị chảy nước
  let history: any[] = [];
  console.log('Khách: Máy lạnh nhà tôi bị chảy nước');
  let res1 = await aiService.chatWithAI(userId, 'Máy lạnh nhà tôi bị chảy nước', undefined, history);
  console.log('AI:', res1.text);
  history.push({ role: 'user', content: 'Máy lạnh nhà tôi bị chảy nước' });
  history.push({ role: 'model', content: res1.text });

  // Khách: Ok gọi thợ giúp tôi
  console.log('\nKhách: Ok gọi thợ giúp tôi (Kỳ vọng AI chốt đơn & isGolden = true)');
  let res2 = await aiService.chatWithAI(userId, 'Ok gọi thợ giúp tôi, cho thợ qua luôn nhé', undefined, history);
  console.log('AI:', res2.text);
  console.log('=> is_booking_triggered:', res2.is_booking_triggered);
  if (res2.logId) {
    const log = await prisma.aiReasoningLog.findUnique({ where: { id: res2.logId } });
    console.log(`=> DB Log #${res2.logId} Score: ${log?.score}, isGolden: ${log?.isGolden}`);
  }


  console.log('\n==================================================');
  console.log('🔴 BƯỚC 2: TẠO "NEGATIVE EXAMPLE" (MỒI ĐIỂM ÂM)');
  console.log('==================================================');
  
  console.log('Khách: Máy lạnh kêu to quá (Phiên chat mới)');
  let res3 = await aiService.chatWithAI(userId, 'Máy lạnh kêu to quá', undefined, []);
  console.log('AI:', res3.text);
  
  if (res3.logId) {
    console.log(`\n=> Bấm nút DISLIKE cho Log #${res3.logId}...`);
    await aiService.saveFeedback(res3.logId, 'DISLIKE');
    const log = await prisma.aiReasoningLog.findUnique({ where: { id: res3.logId } });
    console.log(`=> DB Log #${res3.logId} Score mới: ${log?.score}`);
  }

  console.log('\n==================================================');
  console.log('✨ BƯỚC 3: KIỂM TRA GET GOLDEN EXAMPLES');
  console.log('==================================================');
  const examples = await aiService.getGoldenExamples('Máy lạnh', 2);
  console.log('\n[VÍ DỤ TRẢ LỜI XUẤT SẮC ĐÃ CHỐT ĐƠN]:');
  examples.golden.forEach((e, i) => console.log(`[Tốt #${i+1}] Khách: "${e.userMsg}"\nAI: "${e.aiResponse}"\n`));
  
  console.log('\n[VÍ DỤ CẦN TRÁNH GÂY KHÓ CHỊU CHO KHÁCH]:');
  if (examples.negative) {
    console.log(`[Xấu] Khách: "${examples.negative.userMsg}"\nAI: "${examples.negative.aiResponse}"`);
  } else {
    console.log('(Không có)');
  }

  console.log('\n✅ BÀI TEST HOÀN TẤT. Sếp có thể xem log ở trên!');
  await app.close();
}

bootstrap();
