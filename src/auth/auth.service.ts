import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto'; // Import DTO vào đây
import { ZaloLoginDto } from './dto/zalo-login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { v4 as uuidv4 } from 'uuid';
import * as admin from 'firebase-admin';
import { RequestResetOtpDto } from './dto/request-reset-otp.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { ForgotPasswordOtpStore } from './forgot-password-otp.store';
import { MailService } from './mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly forgotPasswordOtpStore: ForgotPasswordOtpStore,
    private readonly mailService: MailService,
  ) {}

  private assertAccountIsActive(user: { isActive: boolean }) {
    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản đã bị khóa.');
    }
  }

  // 1. Chức năng Đăng ký (Cập nhật để nhận RegisterDto)
  private getEmailVerificationOtpKey(userId: number, email: string) {
    return `email-verification:${userId}:${email}`;
  }

  async register(dto: RegisterDto) {
    const {
      email,
      phoneNumber,
      password,
      fullName,
      gender,
      address,
      avatarUrl,
    } = dto;

    // Kiểm tra xem Email HOẶC Số điện thoại đã tồn tại chưa
    const userExists = await this.prisma.user.findFirst({
      where: {
        OR: [{ phoneNumber: phoneNumber }, { email: email }],
      },
    });

    if (userExists) {
      if (userExists.phoneNumber === phoneNumber) {
        throw new ConflictException('Số điện thoại này đã được đăng ký!');
      }
      if (userExists.email === email) {
        throw new ConflictException('Email này đã được sử dụng!');
      }
    }

    // Băm mật khẩu
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    // Lưu User mới với đầy đủ thông tin
    const newUser = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phoneNumber,
        password: hashedPassword,
        gender,
        address,
        avatarUrl,
        // role: 'USER', // Nếu bạn có phân quyền, mặc định là USER
      },
    });

    return {
      message: 'Đăng ký tài khoản SmartElec thành công!',
      userId: newUser.id,
    };
  }

  // 2. Chức năng Đăng nhập (Giữ nguyên hoặc cập nhật nhẹ)
  async login(phoneNumber: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      throw new UnauthorizedException('Thông tin đăng nhập không chính xác');
    }

    const isMatch = await bcrypt.compare(pass, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Thông tin đăng nhập không chính xác');
    }

    this.assertAccountIsActive(user);

    const payload = {
      sub: user.id,
      role: user.role,
    };

    // Cập nhật lastLogin khi đăng nhập thành công
    this.assertAccountIsActive(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return {
      message: 'Đăng nhập thành công!',
      userId: user.id,
      role: user.role,
      needsPassword: user.needsPassword,
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  // 3. Lấy thông tin cá nhân
  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        fullName: true,
        email: true,
        role: true,
        avatarUrl: true,
        address: true,
        gender: true,
        needsPassword: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Người dùng không tồn tại');
    }

    return user;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. ĐĂNG NHẬP BẰNG ZALO (Auto-Register nếu chưa có tài khoản)
  // ─────────────────────────────────────────────────────────────────
  async loginWithZalo(dto: ZaloLoginDto) {
    const { zaloId, name, avatarUrl } = dto;

    // Tìm user theo zaloId
    let user = await this.prisma.user.findUnique({
      where: { zaloId },
    });

    let isNewUser = false;

    if (!user) {
      // ✅ AUTO-REGISTER: Tạo tài khoản mới từ thông tin Zalo
      isNewUser = true;
      const tempPassword = uuidv4(); // Mật khẩu tạm (random UUID)
      const salt = await bcrypt.genSalt();
      const hashedTempPassword = await bcrypt.hash(tempPassword, salt);
      const tempPhone = `ZALO_${zaloId.substring(0, 15)}`; // SĐT tạm, unique

      user = await this.prisma.user.create({
        data: {
          zaloId,
          fullName: name || 'Người dùng Zalo',
          avatarUrl: avatarUrl || null,
          phoneNumber: tempPhone,
          password: hashedTempPassword,
          gender: 'OTHER',
          needsPassword: true, // Đánh dấu cần đặt mật khẩu + SĐT thật
        },
      });

      console.log(
        `🔵 [ZALO] Người dùng MỚI đăng ký qua Zalo: ID=${user.id}, ZaloID=${zaloId}, Tên="${name}"`,
      );
    } else {
      console.log(
        `🔵 [ZALO] Người dùng đăng nhập qua Zalo: ID=${user.id}, ZaloID=${zaloId}, Tên="${user.fullName}"`,
      );
    }

    // Cập nhật lastLogin
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    this.assertAccountIsActive(user);

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      message: isNewUser
        ? '🔵 Tạo tài khoản SmartElec qua Zalo thành công!'
        : '🔵 Đăng nhập qua Zalo thành công!',
      userId: user.id,
      role: user.role,
      isNewUser,
      needsPassword: user.needsPassword,
      loginMethod: 'ZALO',
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. ĐẶT MẬT KHẨU & SĐT CHO USER ZALO LẦN ĐẦU
  // ─────────────────────────────────────────────────────────────────
  async setPasswordForZaloUser(userId: number, dto: SetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    if (!user.needsPassword) {
      throw new ConflictException('Tài khoản đã có mật khẩu rồi!');
    }

    // Kiểm tra SĐT đã được sử dụng bởi user khác chưa
    const phoneExists = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });

    if (phoneExists && phoneExists.id !== userId) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký bởi tài khoản khác!',
      );
    }

    // Băm mật khẩu mới
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.newPassword, salt);

    // Cập nhật SĐT + mật khẩu + tắt flag needsPassword
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phoneNumber: dto.phoneNumber,
        password: hashedPassword,
        needsPassword: false,
      },
    });

    console.log(
      `🔵 [ZALO] User ID=${userId} đã hoàn tất đặt mật khẩu và SĐT: ${dto.phoneNumber}`,
    );

    return {
      message:
        'Đặt mật khẩu và số điện thoại thành công! Chào mừng bạn đến SmartElec.',
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. ĐĂNG NHẬP BẰNG GOOGLE (Auto-Register nếu chưa có tài khoản)
  // ─────────────────────────────────────────────────────────────────
  async loginWithGoogle(dto: GoogleLoginDto) {
    const { idToken } = dto;

    // 1. Xác thực idToken từ Firebase
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      // Kiểm tra Firebase Admin đã được khởi tạo chưa
      if (admin.apps.length === 0) {
        console.error(
          '❌ [GOOGLE] Firebase Admin chưa được khởi tạo! apps.length = 0',
        );
        throw new Error('Firebase Admin chưa được khởi tạo');
      }
      console.log(
        `🔍 [GOOGLE] Bắt đầu verify idToken, Firebase apps: ${admin.apps.length}`,
      );
      decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log(`✅ [GOOGLE] Verify thành công, uid=${decodedToken.uid}`);
    } catch (error) {
      console.error(
        '❌ [GOOGLE] Xác thực Firebase ID Token thất bại:',
        (error as Error).message,
      );
      console.error('❌ [GOOGLE] Full error:', error);
      throw new UnauthorizedException(
        `Token Google không hợp lệ: ${(error as Error).message}`,
      );
    }

    const googleId = decodedToken.uid;
    const email = decodedToken.email || null;
    const name =
      decodedToken.name ||
      decodedToken.email?.split('@')[0] ||
      'Người dùng Google';
    const picture = decodedToken.picture || null;

    // 2. Tìm user theo googleId
    let user = await this.prisma.user.findUnique({
      where: { googleId },
    });

    let isNewUser = false;

    if (!user) {
      // Kiểm tra xem email đã tồn tại chưa (user đã đăng ký bằng SĐT trước đó)
      if (email) {
        const existingUserByEmail = await this.prisma.user.findUnique({
          where: { email },
        });

        if (existingUserByEmail) {
          // Liên kết Google ID vào tài khoản hiện có
          user = await this.prisma.user.update({
            where: { id: existingUserByEmail.id },
            data: { googleId },
          });
          console.log(
            `🟢 [GOOGLE] Liên kết Google vào tài khoản hiện có: ID=${user.id}, Email=${email}`,
          );
        }
      }

      if (!user) {
        // ✅ AUTO-REGISTER: Tạo tài khoản mới từ thông tin Google
        isNewUser = true;
        const tempPassword = uuidv4();
        const salt = await bcrypt.genSalt();
        const hashedTempPassword = await bcrypt.hash(tempPassword, salt);
        const tempPhone = `GOOGLE_${googleId.substring(0, 12)}`;

        user = await this.prisma.user.create({
          data: {
            googleId,
            email: email || null,
            fullName: name,
            avatarUrl: picture,
            phoneNumber: tempPhone,
            password: hashedTempPassword,
            gender: 'OTHER',
            needsPassword: true,
          },
        });

        console.log(
          `🟢 [GOOGLE] Người dùng MỚI đăng ký qua Google: ID=${user.id}, GoogleID=${googleId}, Email=${email}`,
        );
      }
    } else {
      console.log(
        `🟢 [GOOGLE] Người dùng đăng nhập qua Google: ID=${user.id}, GoogleID=${googleId}, Tên="${user.fullName}"`,
      );
    }

    // 3. Cập nhật lastLogin
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    this.assertAccountIsActive(user);

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      message: isNewUser
        ? '🟢 Tạo tài khoản SmartElec qua Google thành công!'
        : '🟢 Đăng nhập qua Google thành công!',
      userId: user.id,
      role: user.role,
      isNewUser,
      needsPassword: user.needsPassword,
      loginMethod: 'GOOGLE',
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  async requestResetOtp(dto: RequestResetOtpDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Email không tồn tại trong hệ thống.');
    }

    const otp = this.generateOtp();
    const ttlMs = Number(
      process.env.FORGOT_PASSWORD_OTP_TTL_MS ?? 5 * 60 * 1000,
    );

    await this.forgotPasswordOtpStore.save(email, otp, ttlMs);
    await this.mailService.sendPasswordResetOtp(email, otp);

    return {
      message: 'Đã gửi mã OTP về email của bạn.',
    };
  }

  async verifyResetOtp(dto: VerifyResetOtpDto) {
    const email = this.normalizeEmail(dto.email);
    await this.assertValidForgotPasswordOtp(email, dto.otp);

    return {
      message: 'Xác minh OTP thành công.',
      verified: true,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Email không tồn tại trong hệ thống.');
    }

    await this.assertValidForgotPasswordOtp(email, dto.otp);

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await this.forgotPasswordOtpStore.delete(email);

    return {
      message: 'Đặt lại mật khẩu thành công.',
    };
  }

  async requestEmailVerificationOtp(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }

    if (!user.email) {
      throw new ConflictException(
        'Tài khoản chưa có email để thực hiện xác minh.',
      );
    }

    if (user.isVerified) {
      throw new ConflictException('Tài khoản đã được xác minh.');
    }

    const otp = this.generateOtp();
    const ttlMs = Number(
      process.env.EMAIL_VERIFICATION_OTP_TTL_MS ?? 5 * 60 * 1000,
    );
    const otpKey = this.getEmailVerificationOtpKey(user.id, user.email);

    await this.forgotPasswordOtpStore.save(otpKey, otp, ttlMs);
    await this.mailService.sendEmailVerificationOtp(user.email, otp);

    return {
      message: 'Đã gửi mã OTP xác minh về email của bạn.',
    };
  }

  async verifyEmailOtp(userId: number, dto: VerifyEmailOtpDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại.');
    }

    if (!user.email) {
      throw new ConflictException(
        'Tài khoản chưa có email để thực hiện xác minh.',
      );
    }

    if (user.isVerified) {
      throw new ConflictException('Tài khoản đã được xác minh.');
    }

    const otpKey = this.getEmailVerificationOtpKey(user.id, user.email);
    await this.assertValidForgotPasswordOtp(otpKey, dto.otp);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    await this.forgotPasswordOtpStore.delete(otpKey);

    return {
      message: 'Xác minh tài khoản thành công.',
      verified: true,
    };
  }

  private async assertValidForgotPasswordOtp(email: string, otp: string) {
    const record = await this.forgotPasswordOtpStore.get(email);

    if (!record) {
      throw new UnauthorizedException('OTP không hợp lệ hoặc đã hết hạn.');
    }

    if (record.otp !== otp) {
      throw new UnauthorizedException('OTP không hợp lệ hoặc đã hết hạn.');
    }
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private generateOtp() {
    return `${Math.floor(100000 + Math.random() * 900000)}`;
  }
}
