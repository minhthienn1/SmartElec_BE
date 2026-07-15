import { IsEmail, IsNotEmpty, Length, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;

  @IsNotEmpty({ message: 'OTP không được để trống' })
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm 6 chữ số' })
  otp!: string;

  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @Length(6, 20, { message: 'Mật khẩu mới phải từ 6 đến 20 ký tự' })
  newPassword!: string;
}
