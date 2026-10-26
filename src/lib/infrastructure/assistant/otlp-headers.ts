/**
 * Parses OTLP header lists in the OTEL_EXPORTER_OTLP_HEADERS format: `k=v,k2=v2`.
 * Splits each entry on the first `=` only, so base64 padding in values survives
 * (`Authorization=Basic cGs6c2s=`). Values may be percent-encoded (`Basic%20abc`).
 * Entries without a key or without `=` are ignored.
 */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!raw) {
        return headers;
    }
    for (const entry of raw.split(',')) {
        const separator = entry.indexOf('=');
        if (separator <= 0) {
            continue;
        }
        const key = entry.slice(0, separator).trim();
        const rawValue = entry.slice(separator + 1).trim();
        if (key === '') {
            continue;
        }
        let value = rawValue;
        try {
            value = decodeURIComponent(rawValue);
        } catch {
            value = rawValue;
        }
        headers[key] = value;
    }
    return headers;
}

/** Inverse of parseOtlpHeaders for display in settings. `%` and `,` in values are percent-encoded so values round-trip. */
export function formatOtlpHeaders(headers: Record<string, string> | undefined): string {
    return Object.entries(headers ?? {})
        .map(([key, value]) => `${key}=${value.replace(/%/g, '%25').replace(/,/g, '%2C')}`)
        .join(',');
}
