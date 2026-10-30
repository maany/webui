import type { ToolDomain } from '@/lib/core/entity/assistant/tool';

export const TOOL_DOMAIN_LABELS: Record<ToolDomain, string> = {
    dids: 'DIDs',
    rules: 'Rules',
    rses: 'RSEs',
    accounts: 'Accounts',
    replicas: 'Replicas',
    subscriptions: 'Subscriptions',
    requests: 'Requests',
    core: 'Core',
};

/** Display order in the Permissions tab (spec 6.4), core tools last. */
export const TOOL_DOMAIN_ORDER: readonly ToolDomain[] = ['dids', 'rules', 'rses', 'accounts', 'replicas', 'subscriptions', 'requests', 'core'];
