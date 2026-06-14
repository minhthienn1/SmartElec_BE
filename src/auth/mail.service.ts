import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    const transporter = this.getTransporter();
    const from = this.configService.get<string>('SMTP_FROM');

    if (!from) {
      throw new InternalServerErrorException('SMTP_FROM chưa được cấu hình.');
    }

    try {
      await transporter.sendMail({
        from,
        to: email,
        subject: 'SmartElec - Mã OTP đặt lại mật khẩu',
        text: `Mã OTP đặt lại mật khẩu của bạn là ${otp}. Mã có hiệu lực trong 5 phút.`,
        html: `<p>Xin chào,</p><p>Mã OTP đặt lại mật khẩu của bạn là <strong>${otp}</strong>.</p><p>Mã có hiệu lực trong 5 phút.</p>`,
      });
    } catch (error) {
      console.error('Failed to send forgot-password OTP email', error);
      throw new InternalServerErrorException(
        'Không thể gửi email OTP lúc này.',
      );
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get<string>('SMTP_HOST');
    const portValue = this.configService.get<string>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!host || !portValue || !user || !pass) {
      throw new InternalServerErrorException(
        'Thông tin SMTP chưa được cấu hình đầy đủ.',
      );
    }

    const port = Number(portValue);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    return this.transporter;
  }
}
