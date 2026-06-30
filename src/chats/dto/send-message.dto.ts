import {
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MessageType } from '@prisma/client';

export class SendMessageDto {
  @IsEnum(MessageType, {
    message: `type phải là một trong: ${Object.values(MessageType).join(', ')}`,
  })
  @IsNotEmpty({ message: 'type không được để trống' })
  type?: MessageType;

  @IsString({ message: 'content phải là chuỗi' })
  @IsNotEmpty({ message: 'content không được để trống' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content?: string;

  @IsOptional()
  @IsObject({ message: 'metadata phải là một object' })
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString({ message: 'deviceType phải là chuỗi' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceType?: string;

  @IsOptional()
  @IsString({ message: 'symptom phải là chuỗi' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  symptom?: string;
}
