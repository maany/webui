import { TransferRequest } from '@/lib/core/entity/request';

/** One line of Rucio's GET /requests/list as render_json writes it: enums by name, RFC 1123 dates. */
export function rucioRequestRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: '6f1c0f6ad4a34c0fa1d0b0f5c2e6a001',
        request_type: 'TRANSFER',
        scope: 'user.jdoe',
        name: 'file_1.root',
        did_type: 'FILE',
        dest_rse_id: 'b2f0c3a4d5e64f7a8b9c0d1e2f3a4b02',
        source_rse_id: 'a1e0b2c3d4e54f6a7b8c9d0e1f2a3b01',
        attributes: '{"activity": "User Subscriptions", "bytes": 1048576}',
        state: 'SUBMITTED',
        external_id: 'fts-job-1',
        external_host: 'https://fts3.example.org:8446',
        retry_count: 0,
        err_msg: null,
        previous_attempt_id: null,
        rule_id: 'c3a1d2e3f4a54b6c7d8e9f0a1b2c3d03',
        activity: 'User Subscriptions',
        bytes: 1048576,
        md5: null,
        adler32: '0cc737eb',
        dest_url: 'davs://bnl.example.org:443/atlasdatadisk/user/jdoe/file_1.root',
        submitted_at: 'Tue, 07 Jul 2026 13:23:10 UTC',
        started_at: null,
        transferred_at: null,
        estimated_at: null,
        submitter_id: null,
        estimated_started_at: null,
        estimated_transferred_at: null,
        staging_started_at: null,
        staging_finished_at: null,
        account: 'jdoe',
        requested_at: 'Tue, 07 Jul 2026 13:20:00 UTC',
        priority: 3,
        transfertool: 'fts3',
        last_processed_by: null,
        last_processed_at: null,
        created_at: 'Tue, 07 Jul 2026 13:20:00 UTC',
        updated_at: 'Tue, 07 Jul 2026 13:23:10 UTC',
        source_rse: 'CERN-PROD_DATADISK',
        dest_rse: 'BNL-OSG2_DATADISK',
        ...overrides,
    };
}

export function toNDJSON(rows: Record<string, unknown>[]): string {
    return rows.map(row => JSON.stringify(row)).join('\n') + '\n';
}

/** What rucioRequestRow() becomes after the gateway conversion. */
export function expectedTransferRequest(overrides: Partial<TransferRequest> = {}): TransferRequest {
    return {
        id: '6f1c0f6ad4a34c0fa1d0b0f5c2e6a001',
        requestType: 'TRANSFER',
        scope: 'user.jdoe',
        name: 'file_1.root',
        didType: 'FILE',
        state: 'SUBMITTED',
        activity: 'User Subscriptions',
        bytes: 1048576,
        sourceRse: 'CERN-PROD_DATADISK',
        destRse: 'BNL-OSG2_DATADISK',
        account: 'jdoe',
        ruleId: 'c3a1d2e3f4a54b6c7d8e9f0a1b2c3d03',
        retryCount: 0,
        priority: 3,
        transfertool: 'fts3',
        externalHost: 'https://fts3.example.org:8446',
        externalId: 'fts-job-1',
        errMsg: null,
        createdAt: '2026-07-07T13:20:00.000Z',
        updatedAt: '2026-07-07T13:23:10.000Z',
        requestedAt: '2026-07-07T13:20:00.000Z',
        submittedAt: '2026-07-07T13:23:10.000Z',
        startedAt: null,
        transferredAt: null,
        ...overrides,
    };
}
