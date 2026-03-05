import { google } from 'googleapis';
import { prisma } from './db/prisma';
import { createGoogleAuth } from './google.auth';

const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.send'
];

function encodeMessageToBase64Url(str: string) {
    return Buffer.from(str, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export class GoogleErpWorker {
    private auth = createGoogleAuth(SCOPES);

    private drive = google.drive({ version: 'v3', auth: this.auth });
    private docs = google.docs({ version: 'v1', auth: this.auth });
    private gmail = google.gmail({ version: 'v1', auth: this.auth });
    private sheets = google.sheets({ version: 'v4', auth: this.auth });

    async ensureTenantDriveFolder(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        if (tenant.googleDriveFolderId) return tenant.googleDriveFolderId;

        const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

        const res = await this.drive.files.create({
            requestBody: {
                name: `ERP - ${tenant.name}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: root ? [root] : undefined
            },
            fields: 'id'
        });

        const folderId = res.data.id!;
        await prisma.tenant.update({
            where: { id: tenantId },
            data: { googleDriveFolderId: folderId }
        });

        return folderId;
    }

    async generateInvoicePdfToDrive(tenantId: string, invoiceId: string) {
        const invoice = await prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true, lines: true, tenant: true }
        });
        if (!invoice) throw new Error('Invoice not found');

        const templateId = process.env.GOOGLE_INVOICE_TEMPLATE_DOC_ID;
        if (!templateId) throw new Error('Missing GOOGLE_INVOICE_TEMPLATE_DOC_ID');

        const folderId = await this.ensureTenantDriveFolder(tenantId);

        // 1) Copy template doc to tenant folder
        const copy = await this.drive.files.copy({
            fileId: templateId,
            requestBody: {
                name: `Invoice-${invoice.id}`,
                parents: [folderId]
            },
            fields: 'id'
        });

        const docId = copy.data.id!;
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

        // 2) Replace placeholders
        await this.docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });

        // 3) Export doc to PDF bytes
        const pdf = await this.drive.files.export(
            { fileId: docId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdf.data as ArrayBuffer);

        // 4) Upload PDF file
        const pdfUpload = await this.drive.files.create({
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
        const link = pdfUpload.data.webViewLink ?? '';

        await prisma.invoice.update({
            where: { id: invoiceId },
            data: { driveDocFileId: docId, drivePdfFileId: pdfId }
        });

        return { docId, pdfId, link };
    }

    async sendInvoiceEmail(tenantId: string, invoiceId: string) {
        const invoice = await prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true }
        });
        if (!invoice) throw new Error('Invoice not found');
        if (!invoice.customer.email) throw new Error('Customer email missing');

        const artifact = await this.generateInvoicePdfToDrive(tenantId, invoiceId);

        const to = invoice.customer.email;
        const subject = `Invoice ${invoice.id}`;
        const body = [
            `Hello ${invoice.customer.name},`,
            ``,
            `Your invoice is ready.`,
            `View/Download: ${artifact.link || `Drive file id: ${artifact.pdfId}`}`,
            ``,
            `Thank you.`
        ].join('\n');

        const raw = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            ``,
            body
        ].join('\r\n');

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodeMessageToBase64Url(raw) }
        });

        return { ok: true, to };
    }

    async exportInventoryToSheet(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        const products = await prisma.product.findMany({ where: { tenantId }, orderBy: { sku: 'asc' } });
        const moves = await prisma.stockMovement.findMany({ where: { tenantId } });

        const stockMap = new Map<string, number>();
        for (const p of products) stockMap.set(p.id, 0);

        for (const m of moves) {
            const cur = stockMap.get(m.productId) ?? 0;
            if (m.type === 'IN') stockMap.set(m.productId, cur + m.quantity);
            if (m.type === 'OUT') stockMap.set(m.productId, cur - m.quantity);
            if (m.type === 'ADJUST') stockMap.set(m.productId, m.quantity);
        }

        // Create sheet if missing
        let spreadsheetId = tenant.inventorySheetId ?? null;

        if (!spreadsheetId) {
            const created = await this.sheets.spreadsheets.create({
                requestBody: {
                    properties: { title: `Inventory Report - ${tenant.name}` }
                }
            });

            spreadsheetId = created.data.spreadsheetId!;
            await prisma.tenant.update({
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

        await this.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'A1:D10000',
            valueInputOption: 'RAW',
            requestBody: { values }
        });

        return { spreadsheetId };
    }
}