import { searchToolSpecs, stem, type SearchableToolSpec } from '@/lib/core/services/assistant-tool-search';

const SPECS: SearchableToolSpec[] = [
    { name: 'list_rules', domain: 'rules', description: 'List replication rules with their state (OK, Replicating, Stuck) and lock counts.' },
    { name: 'get_rule', domain: 'rules', description: 'Get one replication rule by id.' },
    { name: 'list_rule_replica_lock_states', domain: 'rules', description: 'List the replica locks of a rule with their state.' },
    { name: 'get_rse_usage', domain: 'rses', description: 'Get storage usage of an RSE.' },
    { name: 'list_rses', domain: 'rses', description: 'List RSEs matching an RSE expression.' },
    { name: 'get_account_quotas', domain: 'accounts', description: 'Get the quotas and usage of an account.' },
    { name: 'list_account_identities', domain: 'accounts', description: 'List the identities mapped to an account.' },
    { name: 'list_dataset_replicas', domain: 'replicas', description: 'List the replicas of a dataset per RSE.' },
];

describe('stem', () => {
    it('strips plural endings', () => {
        expect(stem('Rules')).toBe('rule');
        expect(stem('rses')).toBe('rse');
        expect(stem('identities')).toBe('identity');
        expect(stem('access')).toBe('access');
        expect(stem('dn')).toBe('dn');
    });
});

describe('searchToolSpecs', () => {
    it('ranks name matches above description matches', () => {
        const hits = searchToolSpecs(SPECS, 'rse usage');
        expect(hits[0].name).toBe('get_rse_usage');
        expect(hits.map(hit => hit.name)).toContain('list_rses');
    });

    it('uses related words for stuck rules', () => {
        const names = searchToolSpecs(SPECS, 'how many of my rules are stuck').map(hit => hit.name);
        expect([...names.slice(0, 2)].sort()).toEqual(['list_rule_replica_lock_states', 'list_rules']);
    });

    it('matches plural and singular forms', () => {
        expect(searchToolSpecs(SPECS, 'quota')[0].name).toBe('get_account_quotas');
        expect(searchToolSpecs(SPECS, 'identity')[0].name).toBe('list_account_identities');
    });

    it('filters by domain', () => {
        const unfiltered = searchToolSpecs(SPECS, 'usage');
        expect(unfiltered.some(hit => hit.domain !== 'rses')).toBe(true);
        const hits = searchToolSpecs(SPECS, 'usage', { domain: 'rses' });
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(hit => hit.domain === 'rses')).toBe(true);
    });

    it('falls back to every tool of the domain when nothing matches', () => {
        const hits = searchToolSpecs(SPECS, 'zzz', { domain: 'accounts' });
        expect(hits.map(hit => hit.name)).toEqual(['get_account_quotas', 'list_account_identities']);
        expect(hits.every(hit => hit.score === 0)).toBe(true);
    });

    it('returns nothing for stopwords only or unknown words without a domain', () => {
        expect(searchToolSpecs(SPECS, 'show me all of the')).toEqual([]);
        expect(searchToolSpecs(SPECS, 'zzz')).toEqual([]);
    });

    it('respects the limit and sorts ties by name', () => {
        const hits = searchToolSpecs(SPECS, 'replica rule', { limit: 3 });
        expect(hits).toHaveLength(3);
        const scores = hits.map(hit => hit.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        const tied = searchToolSpecs(SPECS, 'account');
        expect(tied[0].score).toBe(tied[1].score);
        expect(tied.map(hit => hit.name)).toEqual(['get_account_quotas', 'list_account_identities']);
    });

    it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('does not throw for the inherited property name %s', query => {
        expect(() => searchToolSpecs(SPECS, query)).not.toThrow();
        expect(searchToolSpecs(SPECS, `${query} quota`)[0].name).toBe('get_account_quotas');
    });

    it('clamps odd limits', () => {
        expect(searchToolSpecs(SPECS, 'rule', { limit: -1 })).toEqual([]);
        expect(searchToolSpecs(SPECS, 'rule', { limit: 0 })).toEqual([]);
        expect(searchToolSpecs(SPECS, 'rule', { limit: Number.NaN }).length).toBeGreaterThan(0);
        expect(searchToolSpecs(SPECS, 'rule', { limit: 2.9 })).toHaveLength(2);
        expect(searchToolSpecs(SPECS, 'rule', { limit: 100 }).length).toBeLessThanOrEqual(SPECS.length);
    });
});
