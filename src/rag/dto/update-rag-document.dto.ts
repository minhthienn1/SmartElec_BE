import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AccessLevel, RagDocumentKind } from '@prisma/client';
import { RAG_LIMITS } from '../rag.constants';

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0);
      }
    } catch {
      return trimmed
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    return [trimmed];
  }

  return undefined;
}

export class UpdateRagDocumentDto {
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_TEXT_FIELD_CHARS || 200)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_DESCRIPTION_CHARS || 2000)
  description?: string;

  @IsOptional()
  @IsEnum(RagDocumentKind)
  kind?: RagDocumentKind;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_TEXT_FIELD_CHARS || 200)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_TEXT_FIELD_CHARS || 200)
  brand?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_TEXT_FIELD_CHARS || 200)
  modelCode?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  @MaxLength(RAG_LIMITS.MAX_TEXT_FIELD_CHARS || 200)
  source?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeTags(value))
  @IsArray()
  @ArrayMaxSize(RAG_LIMITS.MAX_TAGS || 20)
  @IsString({ each: true })
  @MaxLength(RAG_LIMITS.MAX_TAG_LENGTH || 50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(AccessLevel)
  accessLevel?: AccessLevel;
}
