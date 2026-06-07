import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator'; // Thêm IsOptional nếu cần

export class CreateQuoteDto {
  @IsString({ message: 'title phải là chuỗi' })
  @IsNotEmpty({ message: 'title không được để trống' })
  title: string;

  @IsNumber({}, { message: 'amount phải là số' })
  @Min(0, { message: 'amount phải >= 0' })
  amount: number;

  // Thêm trường expectedTime vào đây:
  @IsString({ message: 'expectedTime phải là chuỗi' })
  @IsNotEmpty({ message: 'expectedTime không được để trống' }) 
  expectedTime: string; 
}