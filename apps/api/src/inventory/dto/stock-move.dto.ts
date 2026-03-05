import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export enum StockMoveType {
    IN = 'IN',
    OUT = 'OUT',
    ADJUST = 'ADJUST'
}

export class StockMoveDto {
    @IsEnum(StockMoveType)
    type!: StockMoveType;

    @IsInt()
    @Min(1)
    quantity!: number;

    @IsString()
    @IsOptional()
    note?: string;

    @IsString()
    @IsNotEmpty()
    productId!: string;
}