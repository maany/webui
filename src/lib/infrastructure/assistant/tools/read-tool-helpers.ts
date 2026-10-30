import type { z } from 'zod';
import type { FeatureKey } from '@/lib/core/entity/feature-config';
import type { Role } from '@/lib/core/entity/auth-models';
import type { HttpMethod, ToolDomain, ToolSpec } from '@/lib/core/entity/assistant/tool';
import { API_SCHEMAS, type RouteName } from '@/lib/infrastructure/api-schemas';

/** Tool arguments as the model sends them, i.e. the schema INPUT type (z.input), never the transformed output of a schema. */
export type ToolArgs = Record<string, unknown>;
export type ApiRouteName = RouteName;

export interface ReadToolDefinition {
    route: ApiRouteName;
    domain: ToolDomain;
    description: string;
    output: 'object' | 'rows';
    /** The route's IoC feature flag(s); [] when the route has none. */
    flags: FeatureKey[];
    role?: Role;
    /** Defaults to GET. Only list-account-rse-quotas is a read over POST. */
    method?: HttpMethod;
    describeCall(args: ToolArgs): string;
}

/** "list-did-rules" -> "list_did_rules". */
export function toolNameForRoute(route: string): string {
    return route.replace(/-/g, '_');
}

export function oneLine(value: string, max = 160): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A string view of one argument; arrays are joined, missing values are ''. */
export function text(args: ToolArgs, key: string): string {
    const value = args[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function didOf(args: ToolArgs): string {
    const scope = text(args, 'scope');
    const name = text(args, 'name');
    if (scope && name) return `${scope}:${name}`;
    return scope || name || 'a DID';
}

/** "List rules (state Stuck, account root)"; the label alone when no key has a value. */
export function withFilters(label: string, args: ToolArgs, keys: string[]): string {
    const parts = keys.map(key => [key, text(args, key)] as const).filter(([, value]) => value !== '');
    return parts.length > 0 ? `${label} (${parts.map(([key, value]) => `${key} ${value}`).join(', ')})` : label;
}

export function defineReadTool(definition: ReadToolDefinition): ToolSpec<ToolArgs> {
    return {
        name: toolNameForRoute(definition.route),
        domain: definition.domain,
        description: definition.description,
        input: API_SCHEMAS[definition.route] as unknown as z.ZodType<ToolArgs>,
        risk: 'read',
        requires: definition.role === undefined ? { flags: definition.flags } : { flags: definition.flags, role: definition.role },
        executor: 'feature',
        output: definition.output,
        route: { path: `/api/feature/${definition.route}`, method: definition.method ?? 'GET' },
        describeCall: args => oneLine(definition.describeCall(args ?? {})),
    };
}
