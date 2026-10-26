import { READ_TOOL_SPECS } from '@/lib/infrastructure/assistant/tools';
import { allTools, getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { API_SCHEMAS } from '@/lib/infrastructure/api-schemas';
import { type ListRequestsInput, ListRequestsSchema } from '@/lib/infrastructure/api-schemas/list-requests';
import { describeListRequestsCall, listRequestsSpec, requestToolSpecs, requestTools } from '@/lib/infrastructure/assistant/tools/requests';
import { searchToolSpecs } from '@/lib/core/services/assistant-tool-search';

const EM_DASH = String.fromCharCode(0x2014);

describe('list_requests tool', () => {
    it('is a feature read tool on the requests domain that returns rows', () => {
        expect(listRequestsSpec).toMatchObject({
            name: 'list_requests',
            domain: 'requests',
            risk: 'read',
            executor: 'feature',
            output: 'rows',
            route: { path: '/api/feature/list-requests', method: 'GET' },
            requires: { flags: ['requests'] },
        });
        expect(listRequestsSpec.requires.role).toBeUndefined();
        expect(listRequestsSpec.alwaysOn).toBeFalsy();
    });

    it('takes the route schema as input', () => {
        expect(listRequestsSpec.input).toBe(ListRequestsSchema);
        expect(API_SCHEMAS['list-requests']).toBe(ListRequestsSchema);
    });

    it('tells the model about the admin only default and how to sum bytes', () => {
        const { description } = listRequestsSpec;
        expect(description).toContain('admin');
        expect(description).toContain('forbidden');
        expect(description).toContain('permission_denied');
        expect(description).toContain('SUM(bytes)');
        expect(description).toContain('requests_1');
        expect(description).toContain('QUEUED, SUBMITTING, SUBMITTED, WAITING, PREPARING');
        expect(description).not.toContain(EM_DASH);
        expect(description).toContain('DONE and FAILED');
        expect(description).toContain('lower bound');
    });

    const calls: [ListRequestsInput, string][] = [
        [
            { src_rse: 'CERN-PROD_DATADISK', dst_rse: 'BNL-OSG2_DATADISK' },
            'List transfer requests from CERN-PROD_DATADISK to BNL-OSG2_DATADISK (QUEUED, SUBMITTING, SUBMITTED, WAITING, PREPARING)',
        ],
        [
            { src_site: 'CERN-PROD', dst_site: 'BNL-ATLAS', request_states: ['FAILED'], activity: 'Production' },
            'List transfer requests from site CERN-PROD to site BNL-ATLAS (FAILED, activity Production)',
        ],
    ];

    it.each(calls)('describes %j', (args, expected) => {
        const line = describeListRequestsCall(args);
        expect(line).toBe(expected);
        expect(line).not.toContain(EM_DASH);
        expect(listRequestsSpec.describeCall(args)).toBe(expected);
    });

    it('is registered exactly once and listed with the read specs', () => {
        expect(requestToolSpecs).toEqual([listRequestsSpec]);
        expect(requestTools.map(tool => tool.spec)).toEqual([listRequestsSpec]);
        expect(READ_TOOL_SPECS).toContain(listRequestsSpec);
        expect(allTools().filter(tool => tool.spec.name === 'list_requests')).toHaveLength(1);
        expect(getTool('list_requests')?.spec).toBe(listRequestsSpec);
    });

    it.each(['how much data is in transfer from CERN to BNL', 'transfers between two RSEs', 'queued transfers'])(
        'find_tools surfaces it for "%s"',
        query => {
            expect(searchToolSpecs(READ_TOOL_SPECS, query).map(hit => hit.name)).toContain('list_requests');
        },
    );
});
