import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
    @IsString()
    @IsNotEmpty()
    invoiceId!: string;

    @IsNumber()
    @Min(0.01)
    amount!: number;

    @IsString()
    @IsNotEmpty()
    method!: string;
}