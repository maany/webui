import type { ToolDomain, ToolSpec } from '@/lib/core/entity/assistant/tool';

export type SearchableToolSpec = Pick<ToolSpec, 'name' | 'domain' | 'description'>;

export interface ToolSearchHit {
    name: string;
    domain: ToolDomain;
    description: string;
    score: number;
}

export interface ToolSearchOptions {
    domain?: ToolDomain;
    limit?: number;
}

export const DEFAULT_TOOL_SEARCH_LIMIT = 8;

const STOPWORDS = new Set([
    'a',
    'all',
    'an',
    'and',
    'are',
    'by',
    'can',
    'do',
    'does',
    'for',
    'from',
    'get',
    'how',
    'i',
    'in',
    'is',
    'it',
    'list',
    'many',
    'me',
    'my',
    'of',
    'on',
    'or',
    'per',
    'please',
    'show',
    'the',
    'to',
    'what',
    'which',
    'with',
]);

/** Extra stems a query word also matches, at half weight. Keys and values are already stemmed. */
const RELATED: Record<string, string[]> = {
    stuck: ['rule', 'lock'],
    replicating: ['rule', 'lock'],
    approval: ['rule', 'pending'],
    approve: ['rule', 'pending'],
    quota: ['limit', 'usage'],
    limit: ['quota'],
    space: ['usage', 'quota'],
    storage: ['rse', 'usage'],
    site: ['rse'],
    endpoint: ['rse', 'protocol'],
    dataset: ['did'],
    container: ['did'],
    file: ['did', 'replica'],
    copy: ['replica', 'rule'],
    location: ['replica'],
    user: ['account'],
    identity: ['account'],
    dn: ['identity', 'account'],
    metadata: ['meta', 'keyvaluepair'],
    bad: ['suspicious', 'replica'],
    corrupt: ['suspicious', 'replica'],
};

/** Lower-cases and strips a plural ending so "rules" matches "rule" and "identities" matches "identity". */
export function stem(word: string): string {
    const lower = word.toLowerCase();
    if (lower.length > 4 && lower.endsWith('ies')) return `${lower.slice(0, -3)}y`;
    if (lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1);
    return lower;
}

function words(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word !== '');
}

function score(spec: SearchableToolSpec, terms: string[]): number {
    const nameStems = new Set(words(spec.name).map(stem));
    const descriptionStems = new Set(words(spec.description).map(stem));
    const domainStem = stem(spec.domain);
    const weigh = (term: string, factor: number): number => {
        let points = 0;
        if (nameStems.has(term)) points += 3;
        if (domainStem === term) points += 2;
        if (descriptionStems.has(term)) points += 1;
        return points * factor;
    };
    return terms.reduce((total, term) => {
        const related = RELATED[term] ?? [];
        return total + weigh(term, 1) + related.reduce((sum, other) => sum + weigh(other, 0.5), 0);
    }, 0);
}

/** Ranks tool specs against a keyword query. Pure and deterministic: ties sort by name. */
export function searchToolSpecs(specs: SearchableToolSpec[], query: string, options: ToolSearchOptions = {}): ToolSearchHit[] {
    const limit = options.limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
    const candidates = options.domain ? specs.filter(spec => spec.domain === options.domain) : specs;
    const terms = Array.from(
        new Set(
            words(query)
                .filter(word => !STOPWORDS.has(word))
                .map(stem),
        ),
    );

    const hits = candidates
        .map(spec => ({ name: spec.name, domain: spec.domain, description: spec.description, score: terms.length > 0 ? score(spec, terms) : 0 }))
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, limit);

    if (hits.length === 0 && options.domain) {
        return candidates
            .map(spec => ({ name: spec.name, domain: spec.domain, description: spec.description, score: 0 }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, limit);
    }
    return hits;
}
