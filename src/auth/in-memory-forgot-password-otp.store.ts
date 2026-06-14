import { Injectable } from '@nestjs/common';
import {
  ForgotPasswordOtpRecord,
  ForgotPasswordOtpStore,
} from './forgot-password-otp.store';

@Injectable()
export class InMemoryForgotPasswordOtpStore extends ForgotPasswordOtpStore {
  private readonly otpMap = new Map<string, ForgotPasswordOtpRecord>();

  save(email: string, otp: string, ttlMs: number): void {
    this.otpMap.set(email, {
      otp,
      expiresAt: new Date(Date.now() + ttlMs),
    });
  }

  get(email: string): ForgotPasswordOtpRecord | null {
    const record = this.otpMap.get(email);

    if (!record) {
      return null;
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      this.otpMap.delete(email);
      return null;
    }

    return record;
  }

  delete(email: string): void {
    this.otpMap.delete(email);
  }
}
