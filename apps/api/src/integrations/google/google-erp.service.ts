import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GoogleService } from './google.service';

function encodeMessageToBase64Url(str: string) {
    return Buffer.from(str, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

@Injectable()
export class GoogleErpService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly google: GoogleService
    ) {}

    // Ensure a Drive folder exists for this tenant and persist folder id
    async ensureTenantDriveFolder(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        if (tenant.googleDriveFolderId) return tenant.googleDriveFolderId;

        const drive = this.google.drive();
        const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

        const res = await drive.files.create({
            requestBody: {
                name: `ERP - ${tenant.name}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: root ? [root] : undefined
            },
            fields: 'id'
        });

        const folderId = res.data.id!;
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { googleDriveFolderId: folderId }
        });

        return folderId;
    }

    // Copy invoice template doc, replace placeholders, export to PDF, upload to Drive
    async generateInvoicePdfToDrive(tenantId: string, invoiceId: string) {
        const invoice = await this.prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true, lines: true, tenant: true }
        });
        if (!invoice) throw new Error('Invoice not found');

        const templateId = process.env.GOOGLE_INVOICE_TEMPLATE_DOC_ID;
        if (!templateId) throw new Error('Missing GOOGLE_INVOICE_TEMPLATE_DOC_ID');

        const folderId = await this.ensureTenantDriveFolder(tenantId);

        const drive = this.google.drive();
        const docs = this.google.docs();

        // 1) Copy template doc into tenant folder
        const copy = await drive.files.copy({
            fileId: templateId,
            requestBody: {
                name: `Invoice-${invoice.id}`,
                parents: [folderId]
            },
            fields: 'id'
        });

        const docId = copy.data.id!;
        // 2) Replace placeholders in the doc
        const linesText = invoice.lines
            .map((l) => `${l.name} | ${l.qty} x ${Number(l.unitPrice).toFixed(2)} = ${Number(l.lineTotal).toFixed(2)}`)
            .join('\n');

        const replacements: Record<string, string> = {
            '{{INVOICE_ID}}': invoice.id,
            '{{CUSTOMER_NAME}}': invoice.customer.name,
            '{{CUSTOMER_EMAIL}}': invoice.customer.email ?? '',
            '{{STATUS}}': invoice.status,
            '{{TOTAL}}': Number(invoice.total).toFixed(2),
            '{{LINES}}': linesText,
            '{{DATE}}': new Date(invoice.createdAt).toISOString().slice(0, 10)
        };

        const requests = Object.entries(replacements).map(([find, replaceText]) => ({
            replaceAllText: {
                containsText: { text: find, matchCase: true },
                replaceText
            }
        }));

        await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });

        // 3) Export doc as PDF bytes
        const pdf = await drive.files.export(
            { fileId: docId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );

        const pdfBuffer = Buffer.from(pdf.data as ArrayBuffer);

        // 4) Upload PDF to Drive
        const pdfUpload = await drive.files.create({
            requestBody: {
                name: `Invoice-${invoice.id}.pdf`,
                parents: [folderId]
            },
            media: {
                mimeType: 'application/pdf',
                body: pdfBuffer
            },
            fields: 'id, webViewLink'
        });

        const pdfId = pdfUpload.data.id!;
        await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: { driveDocFileId: docId, drivePdfFileId: pdfId }
        });

        // Make link accessible inside org (optional; depends on org policies).
        // If you want public link, you'd add permissions.create (NOT recommended by default).
        const link = pdfUpload.data.webViewLink ?? '';

        return { docId, pdfId, link };
    }

    async sendInvoiceEmail(tenantId: string, invoiceId: string) {
        const invoice = await this.prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true }
        });
        if (!invoice) throw new Error('Invoice not found');
        if (!invoice.customer.email) throw new Error('Customer email missing');

        // Ensure PDF exists
        const artifact = await this.generateInvoicePdfToDrive(tenantId, invoiceId);

        const gmail = this.google.gmail();
        const to = invoice.customer.email;

        const subject = `Invoice ${invoice.id}`;
        const body = [
            `Hello ${invoice.customer.name},`,
            ``,
            `Please find your invoice attached via Drive link:`,
            artifact.link || `Drive File ID: ${artifact.pdfId}`,
            ``,
            `Thank you.`
        ].join('\n');

        // Basic RFC 2822 email
        const raw = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            ``,
            body
        ].join('\r\n');

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodeMessageToBase64Url(raw) }
        });

        return { ok: true, to };
    }

    async exportInventoryToSheet(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        const products = await this.prisma.product.findMany({ where: { tenantId }, orderBy: { sku: 'asc' } });
        const moves = await this.prisma.stockMovement.findMany({ where: { tenantId } });

        // compute stock per product
        const stockMap = new Map<string, number>();
        for (const p of products) stockMap.set(p.id, 0);

        for (const m of moves) {
            const cur = stockMap.get(m.productId) ?? 0;
            if (m.type === 'IN') stockMap.set(m.productId, cur + m.quantity);
            if (m.type === 'OUT') stockMap.set(m.productId, cur - m.quantity);
            if (m.type === 'ADJUST') stockMap.set(m.productId, m.quantity);
        }

        const sheets = this.google.sheets();

        // Create sheet if missing
        let spreadsheetId = tenant.inventorySheetId ?? null;
        if (!spreadsheetId) {
            const created = await sheets.spreadsheets.create({
                requestBody: {
                    properties: { title: `Inventory Report - ${tenant.name}` }
                }
            });
            spreadsheetId = created.data.spreadsheetId!;
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { inventorySheetId: spreadsheetId }
            });
        }

        const values = [
            ['SKU', 'Name', 'Price', 'Stock'],
            ...products.map((p) => [
                p.sku,
                p.name,
                Number(p.price).toFixed(2),
                String(stockMap.get(p.id) ?? 0)
            ])
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'A1:D10000',
            valueInputOption: 'RAW',
            requestBody: { values }
        });

        return { spreadsheetId };
    }
}