/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { ForgotPasswordOtpStore } from './forgot-password-otp.store';
import { InMemoryForgotPasswordOtpStore } from './in-memory-forgot-password-otp.store';
import { MailService } from './mail.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'SmartElec_Thaibao1806',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any,
      },
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    MailService,
    {
      provide: ForgotPasswordOtpStore,
      useClass: InMemoryForgotPasswordOtpStore,
    },
  ],
  controllers: [AuthController],
})
export class AuthModule {}
