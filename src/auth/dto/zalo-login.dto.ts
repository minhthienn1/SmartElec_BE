import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ZaloLoginDto {
  @IsNotEmpty({ message: 'OAuth code không được để trống' })
  @IsString()
  code!: string;

  @IsNotEmpty({ message: 'Code verifier không được để trống' })
  @IsString()
  codeVerifier!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsIn(['WEB', 'ANDROID', 'IOS'])
  platform?: 'WEB' | 'ANDROID' | 'IOS';
}