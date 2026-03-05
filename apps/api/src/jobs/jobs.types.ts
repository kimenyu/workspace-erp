export const JOB_QUEUES = {
    GOOGLE: 'google'
} as const;

export const GOOGLE_JOBS = {
    INVOICE_SEND: 'invoice.send',
    INVENTORY_EXPORT: 'inventory.export'
} as const;

export type InvoiceSendJob = {
    tenantId: string;
    invoiceId: string;
};

export type InventoryExportJob = {
    tenantId: string;
};