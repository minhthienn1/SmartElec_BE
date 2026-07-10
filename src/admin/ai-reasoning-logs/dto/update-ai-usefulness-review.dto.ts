import { UsefulnessLabel } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAiUsefulnessReviewDto {
  @IsEnum(UsefulnessLabel)
  humanUsefulnessLabel!: UsefulnessLabel;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  humanUsefulnessNote?: string;
}
