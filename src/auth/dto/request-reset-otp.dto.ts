import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestResetOtpDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string;
}
