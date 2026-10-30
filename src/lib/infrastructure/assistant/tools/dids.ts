import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, didOf, text, withFilters, type ToolArgs } from './read-tool-helpers';
import { AddDidSchema, type AddDidInput } from '@/lib/infrastructure/api-schemas/add-did';
import { AttachDidsSchema, type AttachDidsInput } from '@/lib/infrastructure/api-schemas/attach-dids';
import { SetDidStatusSchema, type SetDidStatusInput } from '@/lib/infrastructure/api-schemas/set-did-status';
import { defineWriteTool } from '@/lib/infrastructure/assistant/write-tool';
import { summarizeAddDid, summarizeAttachDids, summarizeSetDidStatus } from './write-summaries';

export const didToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'list-dids',
        domain: 'dids',
        output: 'rows',
        flags: [],
        description:
            'Search data identifiers (DIDs). `query` is required: scope:name, and the name may use * wildcards, for example user.jdoe:*.root. `type` is required: All, Container, Dataset, File or Collection. Optional `filters` are metadata conditions such as length>10 or datatype=AOD. Rows: scope, name, did_type, bytes, length, open.',
        describeCall: args => withFilters(`Search DIDs matching ${text(args, 'query') || 'a pattern'}`, args, ['type', 'filters']),
    }),
    defineReadTool({
        route: 'get-did-meta',
        domain: 'dids',
        output: 'object',
        flags: [],
        description:
            'Get the core metadata of one DID (scope and name): type, owner account, availability, open, obsolete, hidden and suppressed flags, created and updated dates, and for files bytes, adler32, md5 and guid.',
        describeCall: args => `Get metadata of ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'get-did-keyvaluepairs',
        domain: 'dids',
        output: 'object',
        flags: ['dids.metadata'],
        description: 'Get the generic key-value metadata of one DID (scope and name), for example experiment specific keys set with set_metadata.',
        describeCall: args => `Get key-value metadata of ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'list-did-contents',
        domain: 'dids',
        output: 'rows',
        flags: [],
        description:
            'List the direct children of a container or dataset (scope and name). Not recursive. Rows: scope, name, did_type and size fields.',
        describeCall: args => `List contents of ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'list-did-parents',
        domain: 'dids',
        output: 'rows',
        flags: [],
        description: 'List the datasets and containers that a DID (scope and name) is attached to. Rows: scope, name, did_type.',
        describeCall: args => `List parents of ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'list-did-rules',
        domain: 'dids',
        output: 'rows',
        flags: [],
        description:
            'List the replication rules on one DID (scope and name). Rows: id, account, rse_expression, state (OK, Replicating, Stuck, Suspended, Waiting_Approval, Inject), copies, locks_ok_cnt, locks_replicating_cnt, locks_stuck_cnt, activity, created_at, expires_at.',
        describeCall: args => `List rules on ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'get-ami-tag-info',
        domain: 'dids',
        output: 'object',
        flags: ['dids.ami_tags'],
        description:
            'ATLAS only. Look up AMI tags such as f1723 or m2281 (up to 10, comma separated in `tags`) and return their AMI links and details.',
        describeCall: args => `Look up AMI tags ${text(args, 'tags')}`,
    }),
    defineReadTool({
        route: 'get-panda-task-link',
        domain: 'dids',
        output: 'object',
        flags: ['dids.panda_task'],
        description: 'ATLAS only. Get the BigPanDA monitoring link for a PanDA or JEDI task id (`taskId`, 1 to 12 digits).',
        describeCall: args => `Get the PanDA link for task ${text(args, 'taskId')}`,
    }),
];

export const didTools: RegisteredTool<ToolArgs>[] = didToolSpecs.map(spec => createFeatureTool(spec));

// Write tools (phase 4)

export const addDidTool = defineWriteTool<AddDidInput>({
    name: 'add_did',
    domain: 'dids',
    description:
        'Create a new, empty dataset or container DID. type is Dataset or Container. The scope must exist and the account must be allowed to write to it.',
    input: AddDidSchema,
    risk: 'write',
    requires: { flags: ['dids.mutate'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/add-did', method: 'POST' },
    describeCall: summarizeAddDid,
});

export const attachDidsTool = defineWriteTool<AttachDidsInput>({
    name: 'attach_dids',
    domain: 'dids',
    description: 'Attach DIDs (files or datasets) to the dataset or container given by scope and name. The target must be open.',
    input: AttachDidsSchema,
    risk: 'write',
    requires: { flags: ['dids.mutate'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/attach-dids', method: 'POST' },
    describeCall: summarizeAttachDids,
});

export const setDidStatusTool = defineWriteTool<SetDidStatusInput>({
    name: 'set_did_status',
    domain: 'dids',
    description: 'Open or close a dataset or container. open false closes it, and a closed DID accepts no new content.',
    input: SetDidStatusSchema,
    risk: 'write',
    requires: { flags: ['dids.mutate'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/set-did-status', method: 'PUT' },
    describeCall: summarizeSetDidStatus,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DID_WRITE_TOOLS: RegisteredTool<any>[] = [addDidTool, attachDidsTool, setDidStatusTool];
