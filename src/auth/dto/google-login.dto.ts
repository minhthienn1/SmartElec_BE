import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @IsNotEmpty({ message: 'Firebase ID Token không được để trống' })
  @IsString()
  idToken!: string;
}
