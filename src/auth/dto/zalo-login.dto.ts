import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class ZaloLoginDto {
  @IsNotEmpty({ message: 'Zalo ID không được để trống' })
  @IsString()
  zaloId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
