import {
  IsArray,
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { AccessLevel, RagDocumentKind } from '@prisma/client';

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
  description?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  modelCode?: string;

  @IsString()
  @IsOptional()
  source?: string; // Vd: "Manual Daikin 2024", "Kỹ thuật viên nội bộ"

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsEnum(RagDocumentKind)
  @IsOptional()
  kind?: RagDocumentKind;

  @IsEnum(AccessLevel)
  @IsOptional()
  accessLevel?: AccessLevel; // Mặc định: ADVANCED (chỉ thợ)
}
