import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { ForgotPasswordOtpStore } from '../../auth/forgot-password-otp.store';
import { InMemoryForgotPasswordOtpStore } from '../../auth/in-memory-forgot-password-otp.store';
import { MailService } from '../../auth/mail.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAccountsController],
  providers: [
    AdminAccountsService,
    MailService,
    {
      provide: ForgotPasswordOtpStore,
      useClass: InMemoryForgotPasswordOtpStore,
    },
  ],
  exports: [AdminAccountsService],
})
export class AdminAccountsModule {}
