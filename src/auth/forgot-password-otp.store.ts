export type ForgotPasswordOtpRecord = {
  otp: string;
  expiresAt: Date;
};

export abstract class ForgotPasswordOtpStore {
  abstract save(
    email: string,
    otp: string,
    ttlMs: number,
  ): void | Promise<void>;
  abstract get(
    email: string,
  ): ForgotPasswordOtpRecord | null | Promise<ForgotPasswordOtpRecord | null>;
  abstract delete(email: string): void | Promise<void>;
}
