import { PrismaClient, UserRole, Gender } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createTechnician() {
  const phoneNumber = '0903989096';
  const rawPassword = 'Nhozmin1';
  const fullName = 'Kĩ Thuật Viên SmartElec';

  console.log(`🚀 Đang khởi tạo tài khoản cho: ${fullName} (${phoneNumber})...`);

  try {
    // 1. Kiểm tra xem SĐT này đã tồn tại chưa
    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (existingUser) {
      console.log('⚠️ Tài khoản này đã tồn tại trên hệ thống!');
      return;
    }

    // 2. Hash mật khẩu (BCrypt)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(rawPassword, saltRounds);

    // 3. Tạo User mới với Role là TECHNICIAN
    const newUser = await prisma.user.create({
      data: {
        phoneNumber,
        password: hashedPassword,
        fullName,
        role: UserRole.TECHNICIAN,
        gender: Gender.MALE,
        isVerified: true, // Cho phép dùng luôn
        isActive: true,
      },
    });

    console.log('✅ Đã tạo tài khoản Kĩ thuật viên thành công!');
    console.log(`   ID: ${newUser.id}`);
    console.log(`   SĐT: ${newUser.phoneNumber}`);
    console.log(`   Role: ${newUser.role}`);

  } catch (error) {
    console.error('❌ Lỗi khi tạo tài khoản:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTechnician();
