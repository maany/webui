import {
    MAX_PREFILL_RSES,
    resolveRuleCreatePrefill,
    RULE_CREATE_STEPS,
    RuleCreatePrefillSchema,
} from '@/lib/infrastructure/assistant/page-actions/rule-create-prefill';
import { CreateRuleGrouping } from '@/lib/infrastructure/data/view-model/rule';
import { DIDType } from '@/lib/core/entity/rucio';
import { loginPageResponse, ndjsonResponse } from 'test/fixtures/ndjson-response';

const didRow = (name: string, bytes: number) => ({
    status: 'success',
    scope: 'user.jdoe',
    name,
    did_type: DIDType.FILE,
    bytes,
    length: 1,
    open: false,
});
const quotaRow = (rse: string, remaining: number) => ({
    status: 'success',
    rse,
    rse_id: rse,
    account: 'jdoe',
    files: 0,
    used_bytes: 0,
    bytes_limit: 10_000,
    bytes_remaining: remaining,
    has_quota: true,
    total_expected_usage: 1000,
});

let dids: Record<string, unknown[]>;
let quotas: unknown[];
const fetchMockFn = jest.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith('/api/feature/list-dids?')) {
        const query = new URLSearchParams(url.split('?')[1]).get('query') ?? '';
        return ndjsonResponse(dids[query] ?? []);
    }
    if (url === '/api/feature/list-account-rse-quotas') return ndjsonResponse(quotas);
    throw new Error(`unexpected fetch ${url}`);
});

const originalFetch = global.fetch;

beforeEach(() => {
    fetchMockFn.mockClear();
    dids = {
        'user.jdoe:file1': [{ status: 'success', kind: 'progress', progress: {} }, didRow('file1', 1000)],
        'user.jdoe:file2': [didRow('file2', 500)],
    };
    quotas = [quotaRow('CERN-PROD', 5000), quotaRow('DESY', 10)];
    (global as unknown as { fetch: unknown }).fetch = fetchMockFn;
});

afterAll(() => {
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
});

describe('resolveRuleCreatePrefill', () => {
    it('fetches full DID and quota view models and lands on the summary', async () => {
        const result = await resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1' }));

        expect(fetchMockFn.mock.calls[0][0]).toBe('/api/feature/list-dids?query=user.jdoe%3Afile1&type=All');
        const quotaCall = fetchMockFn.mock.calls[1];
        expect(quotaCall[0]).toBe('/api/feature/list-account-rse-quotas');
        expect(JSON.parse(quotaCall[1]!.body as string)).toEqual({ rseExpression: 'tier=1', requestedDIDs: [didRow('file1', 1000)] });

        expect(result.parameters.dids).toEqual([didRow('file1', 1000)]);
        expect(result.parameters.rses.map(rse => rse.rse)).toEqual(['CERN-PROD', 'DESY']);
        expect(result.parameters).toMatchObject({ rseExpression: 'tier=1', copies: 1, needsApproval: false, askApproval: false, sample: false });
        expect(result.activeIndex).toBe(RULE_CREATE_STEPS.SUMMARY);
        expect(result.summary).toContain('Summary');
        expect(result.summary).toContain('1 DID (1.0 kB)');
        expect(result.summary).not.toContain('\u2014');
    });

    it('picks only the named RSEs and stops on the RSE step when none has quota', async () => {
        const result = await resolveRuleCreatePrefill(
            RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1', rses: ['DESY'] }),
        );
        expect(result.parameters.rses.map(rse => rse.rse)).toEqual(['DESY']);
        expect(result.parameters.needsApproval).toBe(true);
        expect(result.activeIndex).toBe(RULE_CREATE_STEPS.RSES);
        expect(result.summary).toContain('Ask for approval');
    });

    it('accepts an approval request with a comment', async () => {
        const result = await resolveRuleCreatePrefill(
            RuleCreatePrefillSchema.parse({
                dids: ['user.jdoe:file1'],
                rseExpression: 'tier=1',
                rses: ['DESY'],
                askApproval: true,
                comments: 'Needed for analysis',
            }),
        );
        expect(result.parameters).toMatchObject({ needsApproval: true, askApproval: true, comments: 'Needed for analysis' });
        expect(result.activeIndex).toBe(RULE_CREATE_STEPS.SUMMARY);
    });

    it('stops on the options step when the options are invalid', async () => {
        const result = await resolveRuleCreatePrefill(
            RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1', copies: 3 }),
        );
        expect(result.activeIndex).toBe(RULE_CREATE_STEPS.OPTIONS);
        expect(result.summary).toContain('copies');
    });

    it('maps the options', async () => {
        const result = await resolveRuleCreatePrefill(
            RuleCreatePrefillSchema.parse({
                dids: ['user.jdoe:file1', 'user.jdoe:file2', 'user.jdoe:file1'],
                rseExpression: 'tier=1',
                lifetimeDays: 7,
                grouping: 'dataset',
                asynchronous: true,
                notify: true,
                sampleFileCount: 2,
            }),
        );
        expect(result.parameters.dids.map(did => did.name)).toEqual(['file1', 'file2']);
        expect(result.parameters).toMatchObject({
            daysLifetime: 7,
            grouping: CreateRuleGrouping.DATASET,
            asynchronous: true,
            notify: true,
            sample: true,
            sampleFileCount: 2,
        });
    });

    it('reports unknown DIDs and RSEs', async () => {
        await expect(
            resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:missing'], rseExpression: 'tier=1' })),
        ).rejects.toEqual({
            error: 'not_found',
            message: 'DID user.jdoe:missing was not found.',
        });
        await expect(
            resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1', rses: ['NOWHERE'] })),
        ).rejects.toMatchObject({ error: 'not_found' });
        quotas = [];
        await expect(
            resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=9' })),
        ).rejects.toMatchObject({
            error: 'not_found',
        });
    });

    it('refuses expressions that match too many RSEs', async () => {
        quotas = Array.from({ length: MAX_PREFILL_RSES + 1 }, (_, index) => quotaRow(`RSE${index}`, 5000));
        await expect(
            resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: '*' })),
        ).rejects.toMatchObject({
            error: 'invalid_args',
        });
    });

    it('turns a login redirect into session_expired', async () => {
        fetchMockFn.mockImplementationOnce(async () => loginPageResponse());
        await expect(
            resolveRuleCreatePrefill(RuleCreatePrefillSchema.parse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1' })),
        ).rejects.toMatchObject({
            error: 'session_expired',
        });
    });

    it('rejects wildcards, empty lists and zero copies in the schema', () => {
        expect(RuleCreatePrefillSchema.safeParse({ dids: ['user.jdoe:*'], rseExpression: 'tier=1' }).success).toBe(false);
        expect(RuleCreatePrefillSchema.safeParse({ dids: ['nocolon'], rseExpression: 'tier=1' }).success).toBe(false);
        expect(RuleCreatePrefillSchema.safeParse({ dids: [], rseExpression: 'tier=1' }).success).toBe(false);
        expect(RuleCreatePrefillSchema.safeParse({ dids: ['user.jdoe:file1'], rseExpression: 'tier=1', copies: 0 }).success).toBe(false);
    });
});
