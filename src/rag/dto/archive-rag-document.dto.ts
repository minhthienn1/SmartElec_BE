import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return value;
}

export class ArchiveRagDocumentDto {
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  isActive: boolean;
}
