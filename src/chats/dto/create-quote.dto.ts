import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateQuoteDto {
  @IsString({ message: 'title phải là chuỗi' })
  @IsNotEmpty({ message: 'title không được để trống' })
  title: string;

  @IsNumber({}, { message: 'amount phải là số' })
  @Min(0, { message: 'amount phải >= 0' })
  amount: number;
}
