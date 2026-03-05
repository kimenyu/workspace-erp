import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateProductDto {
    @IsString()
    @IsNotEmpty()
    sku!: string;

    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsNumber()
    price!: number;
}