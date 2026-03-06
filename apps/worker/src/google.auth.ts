import { google } from 'googleapis';

function normalizePrivateKey(key?: string) {
    if (!key) return '';
    return key.replace(/\\n/g, '\n');
}

export function createGoogleAuth(scopes: string[]) {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

    if (!clientEmail || !privateKey) {
        throw new Error('Missing Google env vars: GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
    }

    // Service account auth (no impersonation/subject needed for Drive/Docs/Sheets)
    return new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes,
    });
}

// import { google } from 'googleapis';
//
// function normalizePrivateKey(key?: string) {
//     if (!key) return '';
//     return key.replace(/\\n/g, '\n');
// }
//
// export function createGoogleAuth(scopes: string[]) {
//     const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
//     const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
//     const subject = process.env.GOOGLE_IMPERSONATE_USER_EMAIL;
//
//     if (!clientEmail || !privateKey || !subject) {
//         throw new Error('Missing Google env vars for worker');
//     }
//
//     return new google.auth.JWT({
//         email: clientEmail,
//         key: privateKey,
//         scopes,
//         subject
//     });
// }