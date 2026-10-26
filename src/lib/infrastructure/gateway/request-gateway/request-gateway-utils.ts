import { TransferRequestDTO } from '@/lib/core/dto/request-dto';
import { isRequestState } from '@/lib/core/entity/request';

/** One line of GET /requests/list: Request.to_dict() plus the source_rse and dest_rse names added by Rucio. */
export type TRucioRequest = {
    id: string;
    request_type: string;
    scope: string;
    name: string;
    did_type: string;
    dest_rse_id: string;
    source_rse_id: string | null;
    state: string;
    activity: string | null;
    bytes: number | null;
    account: string | null;
    rule_id: string | null;
    retry_count: number | null;
    priority: number | null;
    transfertool: string | null;
    external_host: string | null;
    external_id: string | null;
    err_msg: string | null;
    created_at: string | null;
    updated_at: string | null;
    requested_at: string | null;
    submitted_at: string | null;
    started_at: string | null;
    transferred_at: string | null;
    source_rse?: string | null;
    dest_rse?: string | null;
};

/** Rucio sends RFC 1123 dates ("Tue, 07 Jul 2026 13:23:10 UTC"); ISO 8601 sorts as text and casts in SQL. */
export function rucioDateToISO(value: string | null | undefined): string | null {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Parses one NDJSON line; the SDK stream may hand it over JSON-encoded a second time. */
export function parseRequestLine(chunk: Buffer | string): TRucioRequest {
    const parsed = JSON.parse(chunk.toString());
    return (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as TRucioRequest;
}

export function convertToTransferRequestDTO(data: TRucioRequest): TransferRequestDTO {
    return {
        status: 'success',
        id: data.id,
        requestType: data.request_type,
        scope: data.scope,
        name: data.name,
        didType: data.did_type,
        state: isRequestState(data.state) ? data.state : 'UNKNOWN',
        activity: data.activity ?? null,
        bytes: typeof data.bytes === 'number' ? data.bytes : null,
        sourceRse: data.source_rse ?? null,
        // Rucio adds dest_rse to every row; the id only stands in if a server ever omits it.
        destRse: data.dest_rse ?? data.dest_rse_id,
        account: data.account ?? null,
        ruleId: data.rule_id ?? null,
        retryCount: data.retry_count ?? 0,
        priority: data.priority ?? null,
        transfertool: data.transfertool ?? null,
        externalHost: data.external_host ?? null,
        externalId: data.external_id ?? null,
        errMsg: data.err_msg ?? null,
        createdAt: rucioDateToISO(data.created_at),
        updatedAt: rucioDateToISO(data.updated_at),
        requestedAt: rucioDateToISO(data.requested_at),
        submittedAt: rucioDateToISO(data.submitted_at),
        startedAt: rucioDateToISO(data.started_at),
        transferredAt: rucioDateToISO(data.transferred_at),
    };
}
