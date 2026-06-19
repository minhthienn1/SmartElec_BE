import { IsNotEmpty, Matches } from 'class-validator';

export class VerifyAccountEmailOtpDto {
  @IsNotEmpty({ message: 'OTP không được để trống' })
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm 6 chữ số' })
  otp!: string;
}
