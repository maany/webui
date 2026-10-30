import {
    convertToTransferRequestDTO,
    parseRequestLine,
    rucioDateToISO,
    TRucioRequest,
} from '@/lib/infrastructure/gateway/request-gateway/request-gateway-utils';
import { expectedTransferRequest, rucioRequestRow } from 'test/fixtures/request-fixtures';

describe('request gateway utils', () => {
    it('parses a plain NDJSON line and a JSON encoded one alike', () => {
        const row = rucioRequestRow();
        const line = JSON.stringify(row);
        expect(parseRequestLine(Buffer.from(line))).toEqual(row);
        expect(parseRequestLine(Buffer.from(JSON.stringify(line)))).toEqual(row);
    });

    it('throws on a malformed line so the stream reports an error row', () => {
        expect(() => parseRequestLine('{not json')).toThrow();
    });

    it('turns RFC 1123 dates into ISO and anything else into null', () => {
        expect(rucioDateToISO('Tue, 07 Jul 2026 13:23:10 UTC')).toBe('2026-07-07T13:23:10.000Z');
        expect(rucioDateToISO('not a date')).toBeNull();
        expect(rucioDateToISO('')).toBeNull();
        expect(rucioDateToISO(null)).toBeNull();
        expect(rucioDateToISO(undefined)).toBeNull();
    });

    it('falls back to the destination RSE id when Rucio sends no name', () => {
        const data = rucioRequestRow({ dest_rse: undefined, retry_count: null }) as unknown as TRucioRequest;
        expect(convertToTransferRequestDTO(data)).toEqual({
            status: 'success',
            ...expectedTransferRequest({ destRse: 'b2f0c3a4d5e64f7a8b9c0d1e2f3a4b02', retryCount: 0 }),
        });
    });
});
