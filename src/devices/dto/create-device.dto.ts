import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsDateString,
} from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  brandName: string;

  @IsString()
  @IsOptional()
  modelCode?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  @IsOptional()
  purchaseDate?: string;

  @IsInt()
  @IsOptional()
  warrantyMonths?: number;

  @IsInt()
  @IsOptional()
  maintenanceCycleMonths?: number;
}
