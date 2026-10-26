const SECRET_EXACT_NAMES = new Set(['password', 'secret', 'apikey', 'jwt', 'bearer', 'authorization', 'cookie', 'session', 'sessionid', 'auth']);
const SECRET_SUFFIXES = ['token', 'secret', 'password', 'apikey'];

function normaliseFieldName(name: string): string {
    return name
        .normalize('NFKC')
        .replace(/\p{Cf}/gu, '')
        .toLowerCase()
        .replace(/[-_]/g, '');
}

/**
 * Credential-like field names: exact names, or names ending in token, secret, password or apikey.
 * Columns called key, code or value are not secret here.
 */
export function isSecretFieldName(name: string): boolean {
    const normalised = normaliseFieldName(name);
    return SECRET_EXACT_NAMES.has(normalised) || SECRET_SUFFIXES.some(suffix => normalised.endsWith(suffix));
}
