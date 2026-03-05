import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InvoiceLineDto {
    @IsString()
    @IsOptional()
    productId?: string;

    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsInt()
    @Min(1)
    qty!: number;

    @Min(0)
    unitPrice!: number;
}

export class CreateInvoiceDto {
    @IsString()
    @IsNotEmpty()
    customerId!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InvoiceLineDto)
    lines!: InvoiceLineDto[];
}