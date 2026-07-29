import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export enum RagConversationImportSource {
  CUSTOMER_REVIEW = 'CUSTOMER_REVIEW', //Người dùng đánh giá
  AI_CONCLUSION = 'AI_CONCLUSION', //AI tự đánh giá
}

export class ImportRagConversationDto {
  @IsInt()
  @Min(1)
  sessionId: number;

  @IsEnum(RagConversationImportSource)
  sourceType: RagConversationImportSource;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
