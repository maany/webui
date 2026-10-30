import {
    buildAccountDetailUrl,
    buildAccountsListUrl,
    buildAssistantSettingsUrl,
    buildDashboardUrl,
    buildDIDDetailUrl,
    buildRSEDetailUrl,
    buildRuleCreateUrl,
    buildRuleDetailUrl,
    buildSubscriptionDetailUrl,
} from '@/lib/infrastructure/utils/navigation';

describe('detail and page URL builders', () => {
    it('encodes DID scope and name like the existing DID links', () => {
        expect(buildDIDDetailUrl('user.jdoe', 'file 1')).toBe('/did/user.jdoe/file%201');
        expect(buildDIDDetailUrl('user.jdoe', 'a/b')).toBe('/did/user.jdoe/a%2Fb');
    });

    it('encodes RSE names', () => {
        expect(buildRSEDetailUrl('CERN-PROD')).toBe('/rse/CERN-PROD');
        expect(buildRSEDetailUrl('SITE A')).toBe('/rse/SITE%20A');
    });

    it('adds ?tab= for every account tab except overview', () => {
        expect(buildAccountDetailUrl('jdoe')).toBe('/account/jdoe');
        expect(buildAccountDetailUrl('jdoe', 'overview')).toBe('/account/jdoe');
        expect(buildAccountDetailUrl('jdoe', 'quotas')).toBe('/account/jdoe?tab=quotas');
        expect(buildAccountDetailUrl('jdoe', 'identities')).toBe('/account/jdoe?tab=identities');
    });

    it('encodes subscription account and name', () => {
        expect(buildSubscriptionDetailUrl('jdoe', 'sub one')).toBe('/subscription/jdoe/sub%20one');
    });

    it('returns the fixed page paths', () => {
        expect(buildAccountsListUrl()).toBe('/accounts');
        expect(buildRuleCreateUrl()).toBe('/rule/create');
        expect(buildDashboardUrl()).toBe('/dashboard');
        expect(buildAssistantSettingsUrl()).toBe('/assistant/settings');
    });

    it('encodes rule ids and leaves 32-hex ids unchanged', () => {
        expect(buildRuleDetailUrl('0123456789abcdef0123456789abcdef')).toBe('/rule/0123456789abcdef0123456789abcdef');
        expect(buildRuleDetailUrl('a/b')).toBe('/rule/a%2Fb');
    });
});
