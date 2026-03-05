import { Injectable } from '@nestjs/common';
import { google, drive_v3, docs_v1, gmail_v1, sheets_v4 } from 'googleapis';
import { createGoogleAuth } from './google.auth';

const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.send'
];

@Injectable()
export class GoogleService {
    private auth = createGoogleAuth(SCOPES);

    drive(): drive_v3.Drive {
        return google.drive({ version: 'v3', auth: this.auth });
    }

    docs(): docs_v1.Docs {
        return google.docs({ version: 'v1', auth: this.auth });
    }

    gmail(): gmail_v1.Gmail {
        return google.gmail({ version: 'v1', auth: this.auth });
    }

    sheets(): sheets_v4.Sheets {
        return google.sheets({ version: 'v4', auth: this.auth });
    }
}