import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto'; // Import DTO vào đây

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // 1. Chức năng Đăng ký (Cập nhật để nhận RegisterDto)
  async register(dto: RegisterDto) {
    const { email, phoneNumber, password, fullName, gender, address, avatarUrl } = dto;

    // Kiểm tra xem Email HOẶC Số điện thoại đã tồn tại chưa
    const userExists = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phoneNumber: phoneNumber },
          { email: email },
        ],
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

    const payload = {
      sub: user.id,
      role: user.role,
    };

    // Cập nhật lastLogin khi đăng nhập thành công
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return {
      message: 'Đăng nhập thành công!',
      userId: user.id,
      role: user.role,
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
      },
    });

    if (!user) {
      throw new UnauthorizedException('Người dùng không tồn tại');
    }

    return user;
  }
}