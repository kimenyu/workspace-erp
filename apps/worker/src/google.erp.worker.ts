import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { prisma } from './db/prisma';
import { createGoogleAuth } from './google.auth';

// No Drive scope needed — we write to a pre-existing sheet shared with the service account
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
];

function buildMailTransport() {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env');
    return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

function generateInvoicePdf(invoice: {
    id: string;
    createdAt: Date;
    total: any;
    status: string;
    customer: { name: string; email?: string | null };
    lines: { name: string; qty: number; unitPrice: any; lineTotal: any }[];
}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Invoice ID: ${invoice.id}`, { align: 'right' });
        doc.text(`Date: ${new Date(invoice.createdAt).toISOString().slice(0, 10)}`, { align: 'right' });
        doc.text(`Status: ${invoice.status}`, { align: 'right' });
        doc.moveDown();

        doc.fontSize(12).font('Helvetica-Bold').text('Bill To:');
        doc.fontSize(10).font('Helvetica');
        doc.text(invoice.customer.name);
        if (invoice.customer.email) doc.text(invoice.customer.email);
        doc.moveDown();

        doc.fontSize(11).font('Helvetica-Bold');
        const headerY = doc.y;
        doc.text('Item', 50, headerY, { width: 200 });
        doc.text('Qty', 260, headerY, { width: 60 });
        doc.text('Unit Price', 330, headerY, { width: 90 });
        doc.text('Total', 430, headerY, { width: 90, align: 'right' });
        doc.moveDown(0.3);

        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.3);

        doc.fontSize(10).font('Helvetica');
        for (const line of invoice.lines) {
            const rowY = doc.y;
            doc.text(line.name, 50, rowY, { width: 200 });
            doc.text(String(line.qty), 260, rowY, { width: 60 });
            doc.text(Number(line.unitPrice).toFixed(2), 330, rowY, { width: 90 });
            doc.text(Number(line.lineTotal).toFixed(2), 430, rowY, { width: 90, align: 'right' });
            doc.moveDown(0.5);
        }

        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text(`Total: ${Number(invoice.total).toFixed(2)}`, { align: 'right' });

        doc.end();
    });
}

export class GoogleErpWorker {
    private auth = createGoogleAuth(SCOPES);
    private sheets = google.sheets({ version: 'v4', auth: this.auth });

    async sendInvoiceEmail(tenantId: string, invoiceId: string) {
        const invoice = await prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { customer: true, lines: true },
        });
        if (!invoice) throw new Error('Invoice not found');
        if (!invoice.customer.email) throw new Error('Customer email missing');

        if (invoice.invoiceEmailSentAt) {
            return { ok: true, skipped: true, reason: 'already_sent', to: invoice.customer.email };
        }

        const pdfBuffer = await generateInvoicePdf(invoice);
        const transporter = buildMailTransport();

        await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: invoice.customer.email,
            subject: `Invoice ${invoice.id}`,
            text: [
                `Hello ${invoice.customer.name},`,
                ``,
                `Please find your invoice attached as a PDF.`,
                ``,
                `Thank you.`,
            ].join('\n'),
            attachments: [
                {
                    filename: `Invoice-${invoice.id}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        });

        await prisma.invoice.update({
            where: { id: invoiceId },
            data: { invoiceEmailSentAt: new Date() },
        });

        return { ok: true, to: invoice.customer.email };
    }

    async exportInventoryToSheet(tenantId: string) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new Error('Tenant not found');

        // Skip if exported within last 2 minutes (retry guard)
        const last = tenant.inventoryLastExportedAt?.getTime() ?? 0;
        if (last && Date.now() - last < 2 * 60 * 1000) {
            const spreadsheetId = tenant.inventorySheetId ?? process.env.GOOGLE_INVENTORY_SHEET_ID;
            return {
                skipped: true,
                reason: 'recently_exported',
                spreadsheetId,
                sheetUrl: spreadsheetId
                    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
                    : null,
            };
        }

        // Use sheet from DB (persisted after first export) or fall back to env var
        const spreadsheetId = tenant.inventorySheetId ?? process.env.GOOGLE_INVENTORY_SHEET_ID;
        if (!spreadsheetId) {
            throw new Error(
                'No inventory sheet configured. ' +
                'Create a Google Sheet, share it with the service account, ' +
                'and set GOOGLE_INVENTORY_SHEET_ID in .env'
            );
        }

        // Persist sheet ID to tenant if not already saved
        if (!tenant.inventorySheetId) {
            await prisma.tenant.update({
                where: { id: tenantId },
                data: { inventorySheetId: spreadsheetId },
            });
        }

        const products = await prisma.product.findMany({
            where: { tenantId },
            orderBy: { sku: 'asc' },
        });
        const moves = await prisma.stockMovement.findMany({ where: { tenantId } });

        // Compute current stock per product
        const stockMap = new Map<string, number>();
        for (const p of products) stockMap.set(p.id, 0);
        for (const m of moves) {
            const cur = stockMap.get(m.productId) ?? 0;
            if (m.type === 'IN') stockMap.set(m.productId, cur + m.quantity);
            if (m.type === 'OUT') stockMap.set(m.productId, cur - m.quantity);
            if (m.type === 'ADJUST') stockMap.set(m.productId, m.quantity);
        }

        // Build data rows
        const exportedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const dataRows = products.map((p) => {
            const stock = stockMap.get(p.id) ?? 0;
            const price = Number(p.price);
            return [p.sku, p.name, price, stock, Number((price * stock).toFixed(2))];
        });

        const values = [
            [`Inventory Report — ${tenant.name}`, '', '', '', `Exported: ${exportedAt}`],
            [],
            ['SKU', 'Product Name', 'Price', 'Stock on Hand', 'Stock Value'],
            ...dataRows,
            [],
            ['', '', '', 'TOTAL VALUE', `=SUM(E4:E${products.length + 3})`],
        ];

        // Clear the sheet first then write fresh data
        await this.sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'A1:Z10000',
        });

        await this.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        // Apply formatting
        await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    // Bold title row
                    {
                        repeatCell: {
                            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
                            fields: 'userEnteredFormat.textFormat',
                        },
                    },
                    // Blue header row with white bold text
                    {
                        repeatCell: {
                            range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3 },
                            cell: {
                                userEnteredFormat: {
                                    textFormat: {
                                        bold: true,
                                        foregroundColor: { red: 1, green: 1, blue: 1 },
                                    },
                                    backgroundColor: { red: 0.18, green: 0.46, blue: 0.71 },
                                },
                            },
                            fields: 'userEnteredFormat(textFormat,backgroundColor)',
                        },
                    },
                    // Freeze first 3 rows
                    {
                        updateSheetProperties: {
                            properties: { sheetId: 0, gridProperties: { frozenRowCount: 3 } },
                            fields: 'gridProperties.frozenRowCount',
                        },
                    },
                    // Auto-resize columns A–E
                    {
                        autoResizeDimensions: {
                            dimensions: {
                                sheetId: 0,
                                dimension: 'COLUMNS',
                                startIndex: 0,
                                endIndex: 5,
                            },
                        },
                    },
                ],
            },
        });

        await prisma.tenant.update({
            where: { id: tenantId },
            data: { inventoryLastExportedAt: new Date() },
        });

        const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
        console.log(`✅ Inventory exported to: ${sheetUrl}`);

        return { spreadsheetId, sheetUrl };
    }
}

// import PDFDocument from 'pdfkit';
// import nodemailer from 'nodemailer';
// import { google } from 'googleapis';
// import { prisma } from './db/prisma';
// import { createGoogleAuth } from './google.auth';
//
// const SCOPES = [
//     'https://www.googleapis.com/auth/spreadsheets',
//     'https://www.googleapis.com/auth/drive', // needed to share the sheet
// ];
//
// function buildMailTransport() {
//     const user = process.env.GMAIL_USER;
//     const pass = process.env.GMAIL_APP_PASSWORD;
//     if (!user || !pass) throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env');
//     return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
// }
//
// function generateInvoicePdf(invoice: {
//     id: string;
//     createdAt: Date;
//     total: any;
//     status: string;
//     customer: { name: string; email?: string | null };
//     lines: { name: string; qty: number; unitPrice: any; lineTotal: any }[];
// }): Promise<Buffer> {
//     return new Promise((resolve, reject) => {
//         const doc = new PDFDocument({ margin: 50 });
//         const chunks: Buffer[] = [];
//
//         doc.on('data', (chunk) => chunks.push(chunk));
//         doc.on('end', () => resolve(Buffer.concat(chunks)));
//         doc.on('error', reject);
//
//         doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
//         doc.moveDown(0.5);
//         doc.fontSize(10).font('Helvetica');
//         doc.text(`Invoice ID: ${invoice.id}`, { align: 'right' });
//         doc.text(`Date: ${new Date(invoice.createdAt).toISOString().slice(0, 10)}`, { align: 'right' });
//         doc.text(`Status: ${invoice.status}`, { align: 'right' });
//         doc.moveDown();
//
//         doc.fontSize(12).font('Helvetica-Bold').text('Bill To:');
//         doc.fontSize(10).font('Helvetica');
//         doc.text(invoice.customer.name);
//         if (invoice.customer.email) doc.text(invoice.customer.email);
//         doc.moveDown();
//
//         doc.fontSize(11).font('Helvetica-Bold');
//         const headerY = doc.y;
//         doc.text('Item', 50, headerY, { width: 200 });
//         doc.text('Qty', 260, headerY, { width: 60 });
//         doc.text('Unit Price', 330, headerY, { width: 90 });
//         doc.text('Total', 430, headerY, { width: 90, align: 'right' });
//         doc.moveDown(0.3);
//
//         doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
//         doc.moveDown(0.3);
//
//         doc.fontSize(10).font('Helvetica');
//         for (const line of invoice.lines) {
//             const rowY = doc.y;
//             doc.text(line.name, 50, rowY, { width: 200 });
//             doc.text(String(line.qty), 260, rowY, { width: 60 });
//             doc.text(Number(line.unitPrice).toFixed(2), 330, rowY, { width: 90 });
//             doc.text(Number(line.lineTotal).toFixed(2), 430, rowY, { width: 90, align: 'right' });
//             doc.moveDown(0.5);
//         }
//
//         doc.moveDown(0.3);
//         doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
//         doc.moveDown(0.5);
//         doc.fontSize(12).font('Helvetica-Bold');
//         doc.text(`Total: ${Number(invoice.total).toFixed(2)}`, { align: 'right' });
//
//         doc.end();
//     });
// }
//
// export class GoogleErpWorker {
//     private auth = createGoogleAuth(SCOPES);
//     private drive = google.drive({ version: 'v3', auth: this.auth });
//     private sheets = google.sheets({ version: 'v4', auth: this.auth });
//
//     async sendInvoiceEmail(tenantId: string, invoiceId: string) {
//         const invoice = await prisma.invoice.findFirst({
//             where: { id: invoiceId, tenantId },
//             include: { customer: true, lines: true },
//         });
//         if (!invoice) throw new Error('Invoice not found');
//         if (!invoice.customer.email) throw new Error('Customer email missing');
//
//         if (invoice.invoiceEmailSentAt) {
//             return { ok: true, skipped: true, reason: 'already_sent', to: invoice.customer.email };
//         }
//
//         const pdfBuffer = await generateInvoicePdf(invoice);
//         const transporter = buildMailTransport();
//
//         await transporter.sendMail({
//             from: process.env.GMAIL_USER,
//             to: invoice.customer.email,
//             subject: `Invoice ${invoice.id}`,
//             text: [
//                 `Hello ${invoice.customer.name},`,
//                 ``,
//                 `Please find your invoice attached as a PDF.`,
//                 ``,
//                 `Thank you.`,
//             ].join('\n'),
//             attachments: [
//                 {
//                     filename: `Invoice-${invoice.id}.pdf`,
//                     content: pdfBuffer,
//                     contentType: 'application/pdf',
//                 },
//             ],
//         });
//
//         await prisma.invoice.update({
//             where: { id: invoiceId },
//             data: { invoiceEmailSentAt: new Date() },
//         });
//
//         return { ok: true, to: invoice.customer.email };
//     }
//
//     async exportInventoryToSheet(tenantId: string) {
//         const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
//         if (!tenant) throw new Error('Tenant not found');
//
//         // Skip if exported within last 2 minutes (retry guard)
//         const last = tenant.inventoryLastExportedAt?.getTime() ?? 0;
//         if (last && Date.now() - last < 2 * 60 * 1000) {
//             return {
//                 skipped: true,
//                 reason: 'recently_exported',
//                 spreadsheetId: tenant.inventorySheetId ?? null,
//                 sheetUrl: tenant.inventorySheetId
//                     ? `https://docs.google.com/spreadsheets/d/${tenant.inventorySheetId}`
//                     : null,
//             };
//         }
//
//         const products = await prisma.product.findMany({
//             where: { tenantId },
//             orderBy: { sku: 'asc' },
//         });
//         const moves = await prisma.stockMovement.findMany({ where: { tenantId } });
//
//         // Compute current stock per product
//         const stockMap = new Map<string, number>();
//         for (const p of products) stockMap.set(p.id, 0);
//         for (const m of moves) {
//             const cur = stockMap.get(m.productId) ?? 0;
//             if (m.type === 'IN') stockMap.set(m.productId, cur + m.quantity);
//             if (m.type === 'OUT') stockMap.set(m.productId, cur - m.quantity);
//             if (m.type === 'ADJUST') stockMap.set(m.productId, m.quantity);
//         }
//
//         const isNewSheet = !tenant.inventorySheetId;
//         let spreadsheetId = tenant.inventorySheetId ?? null;
//
//         // Create spreadsheet if it doesn't exist yet
//         if (!spreadsheetId) {
//             const created = await this.sheets.spreadsheets.create({
//                 requestBody: {
//                     properties: { title: `Inventory Report - ${tenant.name}` },
//                 },
//             });
//             spreadsheetId = created.data.spreadsheetId!;
//             await prisma.tenant.update({
//                 where: { id: tenantId },
//                 data: { inventorySheetId: spreadsheetId },
//             });
//         }
//
//         // Write headers + data rows
//         const exportedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
//         const dataRows = products.map((p) => {
//             const stock = stockMap.get(p.id) ?? 0;
//             const price = Number(p.price);
//             return [p.sku, p.name, price, stock, Number((price * stock).toFixed(2))];
//         });
//
//         const values = [
//             [`Inventory Report — ${tenant.name}`, '', '', '', `Exported: ${exportedAt}`],
//             [],
//             ['SKU', 'Product Name', 'Price', 'Stock on Hand', 'Stock Value'],
//             ...dataRows,
//             [],
//             ['', '', '', 'TOTAL VALUE', `=SUM(E4:E${products.length + 3})`],
//         ];
//
//         await this.sheets.spreadsheets.values.update({
//             spreadsheetId,
//             range: 'A1',
//             valueInputOption: 'USER_ENTERED', // allows =SUM formula to evaluate
//             requestBody: { values },
//         });
//
//         // Apply formatting
//         await this.sheets.spreadsheets.batchUpdate({
//             spreadsheetId,
//             requestBody: {
//                 requests: [
//                     // Bold + larger title row
//                     {
//                         repeatCell: {
//                             range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
//                             cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
//                             fields: 'userEnteredFormat.textFormat',
//                         },
//                     },
//                     // Blue header row with white text
//                     {
//                         repeatCell: {
//                             range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3 },
//                             cell: {
//                                 userEnteredFormat: {
//                                     textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
//                                     backgroundColor: { red: 0.18, green: 0.46, blue: 0.71 },
//                                 },
//                             },
//                             fields: 'userEnteredFormat(textFormat,backgroundColor)',
//                         },
//                     },
//                     // Freeze first 3 rows
//                     {
//                         updateSheetProperties: {
//                             properties: { sheetId: 0, gridProperties: { frozenRowCount: 3 } },
//                             fields: 'gridProperties.frozenRowCount',
//                         },
//                     },
//                     // Auto-resize columns A-E
//                     {
//                         autoResizeDimensions: {
//                             dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 5 },
//                         },
//                     },
//                 ],
//             },
//         });
//
//         // On first creation: share with GMAIL_USER so it appears in their Google Drive
//         if (isNewSheet && process.env.GMAIL_USER) {
//             await this.drive.permissions.create({
//                 fileId: spreadsheetId,
//                 requestBody: {
//                     type: 'user',
//                     role: 'writer',
//                     emailAddress: process.env.GMAIL_USER,
//                 },
//                 sendNotificationEmail: true, // user receives "shared with you" email
//             });
//         }
//
//         await prisma.tenant.update({
//             where: { id: tenantId },
//             data: { inventoryLastExportedAt: new Date() },
//         });
//
//         const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
//         console.log(`Inventory sheet: ${sheetUrl}`);
//
//         return { spreadsheetId, sheetUrl, isNewSheet };
//     }
// }