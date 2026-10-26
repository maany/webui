import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, text, type ToolArgs } from './read-tool-helpers';

const rseOf = (args: ToolArgs): string => text(args, 'rseName') || text(args, 'rse') || 'an RSE';

export const rseToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'list-rses',
        domain: 'rses',
        output: 'rows',
        flags: ['rses'],
        description:
            'List the RSEs (Rucio Storage Elements) that match an RSE expression such as tier=1&type=DISK (`rseExpression`, empty for all). Rows: id, name, rse_type, volatile, deterministic, staging_area. Use it to resolve an RSE expression before joining on RSE names.',
        describeCall: args => (text(args, 'rseExpression') ? `List RSEs matching ${text(args, 'rseExpression')}` : 'List RSEs'),
    }),
    defineReadTool({
        route: 'list-all-rses',
        domain: 'rses',
        output: 'rows',
        flags: ['rses'],
        description: 'List every RSE. Rows: id, name, rse_type, volatile, deterministic, staging_area.',
        describeCall: () => 'List all RSEs',
    }),
    defineReadTool({
        route: 'get-rse',
        domain: 'rses',
        output: 'object',
        flags: ['rses'],
        description:
            'Get the details of one RSE by name (`rseName`): type, deterministic, volatile, staging area, availability for read, write and delete, and related settings.',
        describeCall: args => `Get RSE ${rseOf(args)}`,
    }),
    defineReadTool({
        route: 'get-rse-attributes',
        domain: 'rses',
        output: 'object',
        flags: ['rses'],
        description: 'Get the attributes of one RSE (`rse`): key-value pairs such as tier, cloud, country or type that RSE expressions select on.',
        describeCall: args => `Get attributes of ${rseOf(args)}`,
    }),
    defineReadTool({
        route: 'get-rse-protocols',
        domain: 'rses',
        output: 'object',
        flags: ['rses'],
        description:
            'Get the transfer protocols of one RSE (`rse`): scheme, hostname, port, prefix, implementation and LAN or WAN priorities per operation.',
        describeCall: args => `Get protocols of ${rseOf(args)}`,
    }),
    defineReadTool({
        route: 'get-rse-usage',
        domain: 'rses',
        output: 'object',
        flags: ['rses'],
        description:
            'Get the storage usage of one RSE (`rse`) per source (for example rucio, storage, expired): used and total bytes, file count and update time.',
        describeCall: args => `Get usage of ${rseOf(args)}`,
    }),
];

export const rseTools: RegisteredTool<ToolArgs>[] = rseToolSpecs.map(spec => createFeatureTool(spec));
