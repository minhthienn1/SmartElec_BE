import { Transform } from 'class-transformer';
import { IsObject, IsOptional, IsString } from 'class-validator';

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateChatSessionDto {
  @IsOptional()
  @IsString({ message: 'deviceType phải là chuỗi' })
  @Transform(({ value }) => trimString(value))
  deviceType?: string;

  @IsOptional()
  @IsString({ message: 'symptom phải là chuỗi' })
  @Transform(({ value }) => trimString(value))
  symptom?: string;

  @IsOptional()
  @IsString({ message: 'firstMessage phải là chuỗi' })
  @Transform(({ value }) => trimString(value))
  firstMessage?: string;

  @IsOptional()
  @IsObject({ message: 'metadata phải là object' })
  metadata?: Record<string, any>;
}
