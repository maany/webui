import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, didOf, text, withFilters, type ToolArgs } from './read-tool-helpers';
import { DeclareBadReplicasSchema, type DeclareBadReplicasInput } from '@/lib/infrastructure/api-schemas/declare-bad-replicas';
import { defineWriteTool } from '@/lib/infrastructure/assistant/write-tool';
import { summarizeDeclareBadReplicas } from './write-summaries';

export const replicaToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'list-dataset-replicas',
        domain: 'replicas',
        output: 'rows',
        flags: [],
        description:
            'List where a dataset (scope and name) is replicated. Rows: rse, rseblocked, length, state (Available, Unavailable, Copying, Being_Deleted, Bad, Temporary_Unavailable), available_files, available_bytes, creation_date, last_accessed.',
        describeCall: args => `List replicas of dataset ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'list-file-replicas',
        domain: 'replicas',
        output: 'rows',
        flags: [],
        description: 'List the RSEs that hold a file (scope and name) and the replica state on each. Rows: rse, state.',
        describeCall: args => `List replicas of file ${didOf(args)}`,
    }),
    defineReadTool({
        route: 'list-suspicious-replicas',
        domain: 'replicas',
        output: 'rows',
        flags: [],
        description:
            'List replicas declared suspicious (failed checksum or access). Optional filters: rse_expression, younger_than (ISO date), nattempts (minimum number of declarations). Rows: scope, name, rse, rseId, cnt, createdAt.',
        describeCall: args => withFilters('List suspicious replicas', args, ['rse_expression', 'younger_than', 'nattempts']),
    }),
    defineReadTool({
        route: 'get-ddm-link',
        domain: 'replicas',
        output: 'object',
        flags: [],
        description: 'Get the DDM dashboard link that shows transfers of a DID (scope and name) to a destination RSE (`rse`).',
        describeCall: args => `Get the DDM dashboard link for ${didOf(args)} at ${text(args, 'rse') || 'an RSE'}`,
    }),
    defineReadTool({
        route: 'get-fts-link',
        domain: 'replicas',
        output: 'object',
        flags: [],
        description: 'Get the FTS monitoring link for the transfer of a file (scope and name) to an RSE (`rse`).',
        describeCall: args => `Get the FTS link for ${didOf(args)} at ${text(args, 'rse') || 'an RSE'}`,
    }),
];

export const replicaTools: RegisteredTool<ToolArgs>[] = replicaToolSpecs.map(spec => createFeatureTool(spec));

// Write tools (phase 4). The route has no WebUI flag or admin guard, so assistant.bad_replicas is the only switch.

export const declareBadReplicasTool = defineWriteTool<DeclareBadReplicasInput>({
    name: 'declare_bad_replicas',
    domain: 'replicas',
    description:
        'Declare file replicas BAD on one RSE so Rucio recovers them from other copies. High risk: a wrong declaration can lose the last copy. ' +
        'Check the replicas first and give a clear reason. expiresAt is optional.',
    input: DeclareBadReplicasSchema,
    risk: 'high',
    requires: { flags: ['assistant.bad_replicas'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/declare-bad-replicas', method: 'POST' },
    describeCall: summarizeDeclareBadReplicas,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REPLICA_WRITE_TOOLS: RegisteredTool<any>[] = [declareBadReplicasTool];
