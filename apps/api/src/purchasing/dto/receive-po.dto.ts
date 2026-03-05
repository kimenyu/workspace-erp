import { IsNotEmpty, IsString } from 'class-validator';

export class ReceivePurchaseOrderDto {
    @IsString()
    @IsNotEmpty()
    purchaseOrderId!: string;
}