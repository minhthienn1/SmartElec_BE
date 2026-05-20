import { 
  IsNotEmpty, 
  IsString, 
  IsEmail, 
  IsEnum, 
  IsOptional, 
  Length, 
  MaxLength, 
  Matches 
} from 'class-validator';

enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export class RegisterDto {
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString()
  @MaxLength(30, { message: 'Họ tên không được vượt quá 30 ký tự' })
  fullName!: string; // Thêm dấu ! ở đây

  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email!: string; // Thêm dấu !

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @IsString()
  phoneNumber!: string; // Thêm dấu !

  @IsNotEmpty({ message: 'Vui lòng chọn giới tính' })
  @IsEnum(Gender)
  gender!: Gender; // Thêm dấu !

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @IsString()
  @Length(6, 20)
  password!: string; // Thêm dấu !

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}