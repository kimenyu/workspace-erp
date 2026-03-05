import { google } from 'googleapis';
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

/**
 * Worker-side implementation uses Google APIs directly.
 * In a production system you'd call your API or use shared packages.
 * For now we keep it straightforward for copy/paste.
 */
export class GoogleErpWorker {
    private auth = createGoogleAuth(SCOPES);
    private drive = google.drive({ version: 'v3', auth: this.auth });
    private docs = google.docs({ version: 'v1', auth: this.auth });
    private gmail = google.gmail({ version: 'v1', auth: this.auth });
    private sheets = google.sheets({ version: 'v4', auth: this.auth });

    async sendInvoiceEmail(args: { to: string; invoiceId: string; driveLinkOrId: string }) {
        const subject = `Invoice ${args.invoiceId}`;
        const body = [
            `Hello,`,
            ``,
            `Please find your invoice here:`,
            args.driveLinkOrId,
            ``,
            `Thank you.`
        ].join('\n');

        const raw = [
            `To: ${args.to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset="UTF-8"`,
            ``,
            body
        ].join('\r\n');

        await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodeMessageToBase64Url(raw) }
        });
    }

    // NOTE: In worker we typically call API/DB to fetch invoice + tenant settings.
    // For this chunk, the worker expects payloads that already contain what it needs.
    // We'll improve this in the next chunk by sharing code via packages/shared + DB access in worker.
}