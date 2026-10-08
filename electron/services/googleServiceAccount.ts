import fs from 'fs';
import { createPrivateKey } from 'crypto';
import { googleSpeechUniverseDomain } from './outbound';

export interface GoogleServiceAccount {
    type: 'service_account';
    project_id: string;
    client_email: string;
    private_key: string;
    universe_domain?: string;
}

export function validateGoogleServiceAccount(value: unknown): GoogleServiceAccount {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const data = value as Record<string, unknown>;
        if (data.type !== 'service_account'
            || typeof data.project_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(data.project_id)
            || typeof data.client_email !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*@(?:[a-z0-9][a-z0-9-]*\.iam|developer|appspot)\.gserviceaccount\.com$/.test(data.client_email)
            || typeof data.private_key !== 'string' || !/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(data.private_key)) throw new Error();
        // Alternative auth inputs must not be mistaken for service-account metadata.
        for (const key of ['credential_source', 'source_credentials', 'service_account_impersonation_url', 'subject', 'scopes', 'token_url', 'refresh_token', 'client_secret', 'client_id']) {
            // Google-generated service-account files contain a numeric client_id; it is not an OAuth input here.
            if (key === 'client_id' && typeof data[key] === 'string' && /^[0-9]+$/.test(data[key])) continue;
            if (key in data) throw new Error();
        }
        const universe = data.universe_domain === undefined ? 'googleapis.com'
            : typeof data.universe_domain === 'string' ? googleSpeechUniverseDomain(data.universe_domain) : undefined;
        if (!universe) throw new Error();
        const metadataEndpoints: Record<string, string[]> = {
            auth_uri: ['https://accounts.google.com/o/oauth2/auth', `https://accounts.${universe}/o/oauth2/auth`],
            token_uri: ['https://oauth2.googleapis.com/token', 'https://accounts.google.com/o/oauth2/token', `https://oauth2.${universe}/token`],
            auth_provider_x509_cert_url: ['https://www.googleapis.com/oauth2/v1/certs', `https://www.${universe}/oauth2/v1/certs`],
        };
        for (const [key, expected] of Object.entries(metadataEndpoints)) {
            if (key in data && !expected.includes(data[key] as string)) throw new Error();
        }
        if ('client_x509_cert_url' in data) {
            if (typeof data.client_x509_cert_url !== 'string') throw new Error();
            const url = new URL(data.client_x509_cert_url);
            if (!['https://www.googleapis.com', `https://www.${universe}`].includes(url.origin) || url.username || url.password || url.search || url.hash
                || !url.pathname.startsWith('/robot/v1/metadata/x509/')
                || decodeURIComponent(url.pathname.slice('/robot/v1/metadata/x509/'.length)) !== data.client_email) throw new Error();
        }
        if (createPrivateKey(data.private_key).asymmetricKeyType !== 'rsa') throw new Error();
        return { type: 'service_account', project_id: data.project_id, client_email: data.client_email, private_key: data.private_key,
            ...(data.universe_domain === undefined ? {} : { universe_domain: universe }) };
    } catch {
        throw new Error('Invalid Google service account. Select a valid service_account JSON file.');
    }
}

export function loadGoogleServiceAccount(filePath: string): GoogleServiceAccount {
    try {
        if (!filePath || typeof filePath !== 'string') throw new Error();
        return validateGoogleServiceAccount(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        throw new Error('Invalid Google service account. Select a valid service_account JSON file.');
    }
}

export function googleSpeechClientOptions(account: GoogleServiceAccount) {
    const validated = validateGoogleServiceAccount(account);
    return {
        projectId: validated.project_id,
        credentials: { client_email: validated.client_email, private_key: validated.private_key },
        universeDomain: googleSpeechUniverseDomain(process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN ?? validated.universe_domain),
    };
}
