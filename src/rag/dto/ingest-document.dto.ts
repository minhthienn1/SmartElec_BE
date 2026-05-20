import { IsString, IsOptional, IsEnum, IsNotEmpty, MaxLength } from 'class-validator';
import { AccessLevel } from '@prisma/client';

export class IngestDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000) // Giới hạn chunk ~8k ký tự để không quá context window của embedding model
  content: string;

  @IsString()
  @IsOptional()
  category?: string; // Vd: "Máy lạnh", "Tủ lạnh", "Máy giặt"

  @IsString()
  @IsOptional()
  source?: string; // Vd: "Manual Daikin 2024", "Kỹ thuật viên nội bộ"

  @IsEnum(AccessLevel)
  @IsOptional()
  accessLevel?: AccessLevel; // Mặc định: ADVANCED (chỉ thợ)
}
