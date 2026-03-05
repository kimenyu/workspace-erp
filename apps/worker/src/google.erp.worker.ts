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

function base64UrlEncode(buf: Buffer) {
    return buf
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function buildMimeWithPdfAttachment(args: {
    to: string;
    subject: string;
    text: string;
    filename: string;
    pdfBytes: Buffer;
}) {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const headers = [
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`
    ].join('\r\n');

    const textPart = [
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        args.text
    ].join('\r\n');

    // Gmail accepts base64url raw; inside MIME, attachment usually base64 (not base64url)
    const attachmentBase64 = args.pdfBytes.toString('base64');

    const attachmentPart = [
        `--${boundary}`,
        `Content-Type: application/pdf; name="${args.filename}"`,
        `Content-Disposition: attachment; filename="${args.filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        attachmentBase64
    ].join('\r\n');

    const end = `--${boundary}--`;

    const mime = [headers, '', textPart, '', attachmentPart, '', end, ''].join('\r\n');
    return mime;
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

    async downloadDriveFileBytes(fileId: string): Promise<Buffer> {
        const res = await this.drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'arraybuffer' }
        );
        return Buffer.from(res.data as ArrayBuffer);
    }


    async generateInvoicePdfToDrive(tenantId: string, invoiceId: string) {
        const invoice = await prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true, lines: true, tenant: true }
        });
        if (!invoice) throw new Error('Invoice not found');

        // if PDF already exists, reuse it
        if (invoice.drivePdfFileId) {
            return { docId: invoice.driveDocFileId ?? null, pdfId: invoice.drivePdfFileId, link: '' };
        }

        const templateId = process.env.GOOGLE_INVOICE_TEMPLATE_DOC_ID;
        if (!templateId) throw new Error('Missing GOOGLE_INVOICE_TEMPLATE_DOC_ID');

        const folderId = await this.ensureTenantDriveFolder(tenantId);

        // Copy template doc
        const copy = await this.drive.files.copy({
            fileId: templateId,
            requestBody: { name: `Invoice-${invoice.id}`, parents: [folderId] },
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
            replaceAllText: { containsText: { text: find, matchCase: true }, replaceText }
        }));

        await this.docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
        });

        // Export to PDF
        const pdf = await this.drive.files.export(
            { fileId: docId, mimeType: 'application/pdf' },
            { responseType: 'arraybuffer' }
        );
        const pdfBuffer = Buffer.from(pdf.data as ArrayBuffer);

        // Upload PDF
        const pdfUpload = await this.drive.files.create({
            requestBody: { name: `Invoice-${invoice.id}.pdf`, parents: [folderId] },
            media: { mimeType: 'application/pdf', body: pdfBuffer },
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

        // if already emailed, do not re-send
        if (invoice.invoiceEmailSentAt) {
            return { ok: true, skipped: true, reason: 'already_sent', to: invoice.customer.email };
        }

        const artifact = await this.generateInvoicePdfToDrive(tenantId, invoiceId);

        // Optional: share the Drive PDF to the customer
        // Turn on via env if you want it:
        // SHARE_INVOICE_PDF_WITH_CUSTOMER=true
        const share = (process.env.SHARE_INVOICE_PDF_WITH_CUSTOMER ?? 'false').toLowerCase() === 'true';
        if (share && artifact.pdfId) {
            await this.shareFileWithEmail(artifact.pdfId, invoice.customer.email).catch(() => undefined);
        }

        const to = invoice.customer.email;
        const subject = `Invoice ${invoice.id}`;

        const text = [
            `Hello ${invoice.customer.name},`,
            ``,
            `Please find your invoice attached as a PDF.`,
            ``,
            `Thank you.`
        ].join('\n');

        const pdfId = artifact.pdfId;
        if (!pdfId) throw new Error('Invoice PDF missing');

        const pdfBytes = await this.downloadDriveFileBytes(pdfId);

        const mime = buildMimeWithPdfAttachment({
            to,
            subject,
            text,
            filename: `Invoice-${invoice.id}.pdf`,
            pdfBytes
        });

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: base64UrlEncode(Buffer.from(mime, 'utf-8')) }
        });

        // Mark as emailed (idempotency checkpoint)
        await prisma.invoice.update({
            where: { id: invoiceId },
            data: { invoiceEmailSentAt: new Date() }
        });

        return { ok: true, to };
    }

    async shareFileWithEmail(fileId: string, email: string) {
        // This shares the file to the email address.
        // For external emails, your Workspace admin policies must allow it.
        await this.drive.permissions.create({
            fileId,
            requestBody: {
                type: 'user',
                role: 'reader',
                emailAddress: email
            },
            sendNotificationEmail: false
        });
    }

    async exportInventoryToSheet(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        // Idempotency: If exported recently, you can skip.
        // Example: skip if exported within last 2 minutes (job retries)
        const last = tenant.inventoryLastExportedAt?.getTime() ?? 0;
        const now = Date.now();
        if (last && now - last < 2 * 60 * 1000) {
            return { skipped: true, reason: 'recently_exported', spreadsheetId: tenant.inventorySheetId ?? null };
        }

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

        let spreadsheetId = tenant.inventorySheetId ?? null;
        if (!spreadsheetId) {
            const created = await this.sheets.spreadsheets.create({
                requestBody: { properties: { title: `Inventory Report - ${tenant.name}` } }
            });

            spreadsheetId = created.data.spreadsheetId!;
            await prisma.tenant.update({
                where: { id: tenantId },
                data: { inventorySheetId: spreadsheetId }
            });
        }

        const values = [
            ['SKU', 'Name', 'Price', 'Stock'],
            ...products.map((p) => [p.sku, p.name, Number(p.price).toFixed(2), String(stockMap.get(p.id) ?? 0)])
        ];

        await this.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'A1:D10000',
            valueInputOption: 'RAW',
            requestBody: { values }
        });

        await prisma.tenant.update({
            where: { id: tenantId },
            data: { inventoryLastExportedAt: new Date() }
        });

        return { spreadsheetId };
    }
}