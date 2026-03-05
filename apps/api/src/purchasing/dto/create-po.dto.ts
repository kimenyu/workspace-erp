import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsString, Min, ValidateNested } from 'class-validator';

class PoLineDto {
    @IsString()
    @IsNotEmpty()
    productId!: string;

    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsInt()
    @Min(1)
    qty!: number;

    @Min(0)
    unitCost!: number;
}

export class CreatePurchaseOrderDto {
    @IsString()
    @IsNotEmpty()
    supplierId!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PoLineDto)
    lines!: PoLineDto[];
}