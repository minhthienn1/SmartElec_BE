import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
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

type ZaloResolvedProfile = {
  zaloId: string;
  name: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
};

type ZaloTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: number | string;
  error_name?: string;
  error_description?: string;
  message?: string;
};

type ZaloProfileData = {
  id?: string;
  name?: string;
  picture?: string | { data?: { url?: string } };
  avatar?: string;
  phone?: string;
  phoneNumber?: string;
  phone_number?: string;
  PhoneNumber?: string;
  gender?: string | number;
  sex?: string | number;
};

type ZaloProfileResponse = ZaloProfileData & {
  error?: number | string;
  error_name?: string;
  error_description?: string;
  message?: string;
  data?: ZaloProfileData;
};

type GoogleResolvedProfile = {
  googleId: string;
  email: string | null;
  name: string;
  picture: string | null;
};

type GoogleTokenInfoResponse = {
  sub?: string;
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly forgotPasswordOtpStore: ForgotPasswordOtpStore,
    private readonly mailService: MailService,
  ) { }

  private assertAccountIsActive(user: { isActive: boolean }) {
    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản đã bị khóa.');
    }
  }

  private getEmailVerificationOtpKey(userId: number, email: string) {
    return `email-verification:${userId}:${email}`;
  }

  private getOptionalEnv(name: string) {
    const value = process.env[name]?.trim();
    return value || null;
  }

  private getRequiredEnv(name: string) {
    const value = this.getOptionalEnv(name);

    if (!value) {
      throw new BadRequestException(`Thiếu cấu hình ${name}.`);
    }

    return value;
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UnauthorizedException('Zalo trả về dữ liệu không hợp lệ.');
    }
  }

  private getZaloErrorMessage(payload: {
    error?: number | string;
    error_name?: string;
    error_description?: string;
    message?: string;
  }) {
    return (
      payload.error_description ||
      payload.message ||
      payload.error_name ||
      (payload.error !== undefined ? String(payload.error) : null) ||
      'Không thể xác thực Zalo.'
    );
  }

  private async exchangeZaloCodeForAccessToken(
    code: string,
    codeVerifier: string,
    redirectUri?: string,
  ) {
    const tokenUrl =
      this.getOptionalEnv('ZALO_TOKEN_URL') ||
      'https://oauth.zaloapp.com/v4/access_token';

    const appId = this.getRequiredEnv('ZALO_APP_ID');
    const appSecret = this.getRequiredEnv('ZALO_APP_SECRET');

    const resolvedRedirectUri =
      redirectUri?.trim() || this.getOptionalEnv('ZALO_REDIRECT_URI');

    const body = new URLSearchParams({
      app_id: appId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
    });

    if (resolvedRedirectUri) {
      body.set('redirect_uri', resolvedRedirectUri);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: appSecret,
      },
      body,
    });

    const payload = await this.parseJsonResponse<ZaloTokenResponse>(response);

    if (!response.ok || payload.error || !payload.access_token) {
      throw new UnauthorizedException(this.getZaloErrorMessage(payload));
    }

    return payload.access_token;
  }

  private getAvatarFromZaloProfile(data: ZaloProfileData) {
    const picture = data.picture;

    if (typeof picture === 'string') {
      return picture;
    }

    return data.avatar || picture?.data?.url || null;
  }

  private getPhoneFromZaloProfile(data: ZaloProfileData) {
    const value =
      data.phoneNumber ||
      data.phone_number ||
      data.phone ||
      data.PhoneNumber;

    return value?.trim() || null;
  }

  private getGenderFromZaloProfile(
    data: ZaloProfileData,
  ): 'MALE' | 'FEMALE' | 'OTHER' | null {
    const rawValue = data.gender ?? data.sex;

    if (rawValue === undefined || rawValue === null) {
      return null;
    }

    const normalized = String(rawValue).trim().toLowerCase();

    if (normalized === '1' || normalized === 'male' || normalized === 'nam') {
      return 'MALE';
    }

    if (
      normalized === '0' ||
      normalized === '2' ||
      normalized === 'female' ||
      normalized === 'nu' ||
      normalized === 'nữ'
    ) {
      return 'FEMALE';
    }

    return 'OTHER';
  }

  private async fetchZaloProfile(
    accessToken: string,
  ): Promise<ZaloResolvedProfile> {
    const profileUrl = new URL(
      this.getOptionalEnv('ZALO_PROFILE_URL') ||
      'https://graph.zalo.me/v2.0/me',
    );

    profileUrl.searchParams.set(
      'fields',
      this.getOptionalEnv('ZALO_PROFILE_FIELDS') || 'id,name,picture',
    );

    const response = await fetch(profileUrl, {
      method: 'GET',
      headers: {
        access_token: accessToken,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = await this.parseJsonResponse<ZaloProfileResponse>(response);

    if (!response.ok || payload.error) {
      throw new UnauthorizedException(this.getZaloErrorMessage(payload));
    }

    const data = payload.data || payload;
    const zaloId = data.id?.trim();

    if (!zaloId) {
      throw new UnauthorizedException('Không lấy được Zalo ID từ token.');
    }

    return {
      zaloId,
      name: data.name?.trim() || null,
      avatarUrl: this.getAvatarFromZaloProfile(data),
      phoneNumber: this.getPhoneFromZaloProfile(data),
      gender: this.getGenderFromZaloProfile(data),
    };
  }

  private async resolveZaloProfile(dto: ZaloLoginDto) {
    const code = dto.code?.trim();
    const codeVerifier = dto.codeVerifier?.trim();

    if (!code) {
      throw new BadRequestException('Cần gửi OAuth code để đăng nhập Zalo.');
    }

    if (!codeVerifier) {
      throw new BadRequestException('Cần gửi code verifier để đăng nhập Zalo.');
    }

    const accessToken = await this.exchangeZaloCodeForAccessToken(
      code,
      codeVerifier,
      dto.redirectUri,
    );

    return this.fetchZaloProfile(accessToken);
  }

  private async buildZaloAuthResult(
    user: {
      id: number;
      role: string;
      needsPassword: boolean;
    },
    isNewUser: boolean,
  ) {
    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      message: isNewUser
        ? 'Tạo tài khoản SmartElec qua Zalo thành công!'
        : 'Đăng nhập qua Zalo thành công!',
      userId: user.id,
      role: user.role,
      isNewUser,
      needsPassword: user.needsPassword,
      loginMethod: 'ZALO',
      access_token: await this.jwtService.signAsync(payload),
    };
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

    const userExists = await this.prisma.user.findFirst({
      where: {
        OR: [{ phoneNumber }, { email }],
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

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phoneNumber,
        password: hashedPassword,
        gender,
        address,
        avatarUrl,
      },
    });

    return {
      message: 'Đăng ký tài khoản SmartElec thành công!',
      userId: newUser.id,
    };
  }

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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      message: 'Đăng nhập thành công!',
      userId: user.id,
      role: user.role,
      needsPassword: user.needsPassword,
      access_token: await this.jwtService.signAsync(payload),
    };
  }

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

  async loginWithZalo(dto: ZaloLoginDto) {
    const profile = await this.resolveZaloProfile(dto);

    let user = await this.prisma.user.findUnique({
      where: { zaloId: profile.zaloId },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      const tempPassword = uuidv4();
      const hashedTempPassword = await bcrypt.hash(tempPassword, 10);
      const tempPhone =
        profile.phoneNumber || `ZALO_${profile.zaloId.substring(0, 15)}`;

      user = await this.prisma.user.create({
        data: {
          zaloId: profile.zaloId,
          fullName: profile.name || 'Người dùng Zalo',
          avatarUrl: profile.avatarUrl,
          phoneNumber: tempPhone,
          password: hashedTempPassword,
          gender: profile.gender || 'OTHER',
          needsPassword: true,
        },
      });

      console.log(
        `🔵 [ZALO] Tạo user mới: ID=${user.id}, ZaloID=${profile.zaloId}`,
      );
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          avatarUrl: profile.avatarUrl || user.avatarUrl,
          fullName:
            user.fullName && user.fullName !== 'Người dùng Zalo'
              ? user.fullName
              : profile.name || user.fullName,
          phoneNumber:
            user.phoneNumber.startsWith('ZALO_') && profile.phoneNumber
              ? profile.phoneNumber
              : user.phoneNumber,
          gender:
            user.gender === 'OTHER' && profile.gender
              ? profile.gender
              : user.gender,
        },
      });

      console.log(
        `🔵 [ZALO] Đăng nhập user cũ: ID=${user.id}, ZaloID=${profile.zaloId}`,
      );
    }

    this.assertAccountIsActive(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.buildZaloAuthResult(user, isNewUser);
  }

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

    const phoneExists = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });

    if (phoneExists && phoneExists.id !== userId) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký bởi tài khoản khác!',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

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

  private getGoogleClientIds() {
    return [
      this.getOptionalEnv('GOOGLE_CLIENT_ID'),
      this.getOptionalEnv('GOOGLE_WEB_CLIENT_ID'),
      this.getOptionalEnv('FIREBASE_WEB_CLIENT_ID'),
    ].filter((value): value is string => Boolean(value));
  }

  private async verifyGoogleTokenWithGoogle(
    idToken: string,
  ): Promise<GoogleResolvedProfile> {
    const clientIds = this.getGoogleClientIds();

    if (clientIds.length === 0) {
      throw new UnauthorizedException(
        'Thiếu GOOGLE_CLIENT_ID để xác thực Google login.',
      );
    }

    const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
    tokenInfoUrl.searchParams.set('id_token', idToken);

    const response = await fetch(tokenInfoUrl);
    const payload =
      await this.parseJsonResponse<GoogleTokenInfoResponse>(response);

    if (!response.ok || payload.error || !payload.sub) {
      throw new UnauthorizedException(
        payload.error_description || payload.error || 'Token Google không hợp lệ.',
      );
    }

    if (!payload.aud || !clientIds.includes(payload.aud)) {
      throw new UnauthorizedException('Token Google không đúng ứng dụng.');
    }

    return {
      googleId: payload.sub,
      email: payload.email || null,
      name: payload.name || payload.email?.split('@')[0] || 'Người dùng Google',
      picture: payload.picture || null,
    };
  }

  private async resolveGoogleProfile(
    idToken: string,
  ): Promise<GoogleResolvedProfile> {
    try {
      if (admin.apps.length === 0) {
        throw new Error('Firebase Admin chưa được khởi tạo');
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);

      return {
        googleId: decodedToken.uid,
        email: decodedToken.email || null,
        name:
          decodedToken.name ||
          decodedToken.email?.split('@')[0] ||
          'Người dùng Google',
        picture: decodedToken.picture || null,
      };
    } catch (error) {
      console.warn(
        '[GOOGLE] Firebase ID token không hợp lệ, chuyển sang Google ID token:',
        (error as Error).message,
      );

      return this.verifyGoogleTokenWithGoogle(idToken);
    }
  }

  async loginWithGoogle(dto: GoogleLoginDto) {
    const { idToken } = dto;
    const googleProfile = await this.resolveGoogleProfile(idToken);

    let decodedToken: admin.auth.DecodedIdToken | null = null;

    try {
      if (admin.apps.length === 0) {
        console.error('❌ [GOOGLE] Firebase Admin chưa được khởi tạo!');
        throw new Error('Firebase Admin chưa được khởi tạo');
      }

      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error(
        '❌ [GOOGLE] Xác thực Firebase ID Token thất bại:',
        (error as Error).message,
      );

      decodedToken = {
        uid: googleProfile.googleId,
        email: googleProfile.email || undefined,
        name: googleProfile.name,
        picture: googleProfile.picture || undefined,
      } as unknown as admin.auth.DecodedIdToken;
    }

    const googleId = decodedToken.uid;
    const email = decodedToken.email || null;
    const name =
      decodedToken.name ||
      decodedToken.email?.split('@')[0] ||
      'Người dùng Google';
    const picture = decodedToken.picture || null;

    let user = await this.prisma.user.findUnique({
      where: { googleId },
    });

    let isNewUser = false;

    if (!user) {
      if (email) {
        const existingUserByEmail = await this.prisma.user.findUnique({
          where: { email },
        });

        if (existingUserByEmail) {
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
        isNewUser = true;

        const tempPassword = uuidv4();
        const hashedTempPassword = await bcrypt.hash(tempPassword, 10);
        const tempPhone = `GOOGLE_${googleId.substring(0, 12)}`;

        user = await this.prisma.user.create({
          data: {
            googleId,
            email,
            fullName: name,
            avatarUrl: picture,
            phoneNumber: tempPhone,
            password: hashedTempPassword,
            gender: 'OTHER',
            needsPassword: true,
          },
        });

        console.log(
          `🟢 [GOOGLE] Tạo user mới: ID=${user.id}, GoogleID=${googleId}, Email=${email}`,
        );
      }
    } else {
      console.log(
        `🟢 [GOOGLE] Đăng nhập user cũ: ID=${user.id}, GoogleID=${googleId}`,
      );
    }

    this.assertAccountIsActive(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      message: isNewUser
        ? 'Tạo tài khoản SmartElec qua Google thành công!'
        : 'Đăng nhập qua Google thành công!',
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
