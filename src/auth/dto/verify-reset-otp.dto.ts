import { IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class VerifyResetOtpDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;

  @IsNotEmpty({ message: 'OTP không được để trống' })
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm 6 chữ số' })
  otp!: string;
}
