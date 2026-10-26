import {
    ASSISTANT_SESSION_KEYS_KEY,
    ASSISTANT_SETTINGS_KEY,
    clearAssistantSettings,
    getDefaultAssistantSettings,
    loadAssistantSettings,
    saveAssistantSettings,
} from '@/lib/infrastructure/assistant/settings-storage';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ProviderConfig } from '@/lib/core/entity/assistant/provider-config';

const claude: ProviderConfig = { id: 'p-claude', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant-secret', model: 'claude-sonnet-5-5' };
const ollama: ProviderConfig = { id: 'p-ollama', kind: 'ollama', label: 'Local', model: 'qwen3', baseURL: 'http://localhost:11434' };

const withProviders = (overrides: Partial<AssistantSettings> = {}): AssistantSettings => ({
    ...getDefaultAssistantSettings(),
    providers: [claude, ollama],
    activeProviderId: 'p-claude',
    toolPolicies: { create_rule: 'allow', 'group:accounts': 'deny' },
    display: { detail: 'verbose' },
    ...overrides,
});

describe('assistant settings storage', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        jest.restoreAllMocks();
    });

    it('returns the defaults when nothing is stored', () => {
        expect(loadAssistantSettings()).toEqual({
            version: 1,
            providers: [],
            activeProviderId: 'operator',
            keyStorage: 'local',
            toolPolicies: {},
            skills: { enabled: {}, user: [] },
            telemetry: { contentLevel: 'metadata', enabled: false, shareWithOperator: false },
            display: { detail: 'compact' },
            retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
        });
    });

    it('returns fresh default objects', () => {
        const first = getDefaultAssistantSettings();
        first.providers.push(claude);
        first.display.detail = 'verbose';
        expect(getDefaultAssistantSettings().providers).toEqual([]);
        expect(getDefaultAssistantSettings().display.detail).toBe('compact');
    });

    it('round-trips settings through localStorage', () => {
        const settings = withProviders();
        saveAssistantSettings(settings);
        expect(JSON.parse(localStorage.getItem(ASSISTANT_SETTINGS_KEY) ?? '{}')).toEqual(settings);
        expect(loadAssistantSettings()).toEqual(settings);
    });

    it('resets to the defaults on corrupt JSON', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, '{"version":1,"providers":[');
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
    });

    it('resets to the defaults on an old version', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...withProviders(), version: 0 }));
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
    });

    it('resets only the tampered section, and the whole entry for a non-object', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...withProviders(), toolPolicies: { create_rule: 'always' } }));
        expect(loadAssistantSettings()).toEqual({ ...withProviders(), toolPolicies: {} });
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...withProviders(), providers: [{ ...claude, kind: 'gemini' }] }));
        expect(loadAssistantSettings()).toEqual({ ...withProviders(), providers: [] });
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify('just a string'));
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
    });

    it('drops unknown fields', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...withProviders(), injected: '<script>' }));
        expect(loadAssistantSettings()).not.toHaveProperty('injected');
    });

    it('reads settings saved without shareWithOperator as not sharing with the operator', () => {
        const saved = withProviders({ telemetry: { contentLevel: 'full', enabled: true, shareWithOperator: true } });
        const { shareWithOperator, ...oldTelemetry } = saved.telemetry;
        expect(shareWithOperator).toBe(true);
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...saved, telemetry: oldTelemetry }));
        const loaded = loadAssistantSettings();
        expect(loaded.telemetry).toEqual({ contentLevel: 'full', enabled: true, shareWithOperator: false });
        expect(loaded.providers).toEqual(saved.providers);
    });

    it('keeps an explicit operator opt-in', () => {
        saveAssistantSettings(withProviders({ telemetry: { contentLevel: 'metadata', enabled: true, shareWithOperator: true } }));
        expect(loadAssistantSettings().telemetry.shareWithOperator).toBe(true);
    });

    it('resets the telemetry section when shareWithOperator is not a boolean', () => {
        localStorage.setItem(
            ASSISTANT_SETTINGS_KEY,
            JSON.stringify({ ...withProviders(), telemetry: { contentLevel: 'metadata', enabled: true, shareWithOperator: 'yes' } }),
        );
        expect(loadAssistantSettings()).toEqual(withProviders());
    });

    it('keeps API keys out of localStorage when keyStorage is session', () => {
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        const stored = localStorage.getItem(ASSISTANT_SETTINGS_KEY) ?? '';
        expect(stored).not.toContain('sk-ant-secret');
        expect(JSON.parse(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY) ?? '{}')).toEqual({ 'p-claude': 'sk-ant-secret' });
        expect(loadAssistantSettings().providers[0].apiKey).toBe('sk-ant-secret');
    });

    it('loads providers without keys once the session keys are gone', () => {
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        sessionStorage.clear();
        const loaded = loadAssistantSettings();
        expect(loaded.providers[0]).toEqual({ id: 'p-claude', kind: 'anthropic', label: 'My Claude', model: 'claude-sonnet-5-5' });
        expect(loaded.keyStorage).toBe('session');
    });

    it('ignores corrupt session keys', () => {
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        sessionStorage.setItem(ASSISTANT_SESSION_KEYS_KEY, '{oops');
        expect(loadAssistantSettings().providers[0].apiKey).toBeUndefined();
    });

    it('moves keys back to localStorage and clears sessionStorage when switching to local', () => {
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        saveAssistantSettings(withProviders({ keyStorage: 'local' }));
        expect(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY)).toBeNull();
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY)).toContain('sk-ant-secret');
    });

    it('clears both storages', () => {
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        clearAssistantSettings();
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY)).toBeNull();
        expect(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY)).toBeNull();
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
    });

    it('survives a storage that throws', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
        expect(() => saveAssistantSettings(withProviders())).not.toThrow();
    });

    it('leaves no API key in localStorage after switching from local to session', () => {
        saveAssistantSettings(withProviders());
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY)).toContain('sk-ant-secret');
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY)).not.toContain('sk-ant-secret');
    });

    it('never leaves an older plaintext key in localStorage when the session save hits a quota error', () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        saveAssistantSettings(withProviders());
        const realSetItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (this === localStorage) throw new Error('QuotaExceededError');
            realSetItem.call(this, key, value);
        });
        expect(() => saveAssistantSettings(withProviders({ keyStorage: 'session' }))).not.toThrow();
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY) ?? '').not.toContain('sk-ant-secret');
    });

    it('still clears sessionStorage keys when removing from localStorage throws', () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        saveAssistantSettings(withProviders({ keyStorage: 'session' }));
        const realRemoveItem = Storage.prototype.removeItem;
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
            if (this === localStorage) throw new Error('denied');
            realRemoveItem.call(this, key);
        });
        clearAssistantSettings();
        expect(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY)).toBeNull();
    });

    it('keeps providers and resets only the retention section when it is invalid', () => {
        const stored = { ...withProviders(), retention: { maxAgeDays: 1.5, maxTotalMB: 50, clearOnLogout: true } };
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify(stored));
        const loaded = loadAssistantSettings();
        expect(loaded.providers.map(provider => provider.id)).toEqual(['p-claude', 'p-ollama']);
        expect(loaded.activeProviderId).toBe('p-claude');
        expect(loaded.display).toEqual({ detail: 'verbose' });
        expect(loaded.retention).toEqual(getDefaultAssistantSettings().retention);
    });

    it('rejects an out-of-range retention and drops only the invalid providers', () => {
        const stored = {
            ...withProviders(),
            providers: [claude, { id: 'bad', kind: 'nope', label: 'x', model: 'm' }, ollama],
            retention: { maxAgeDays: 99999, maxTotalMB: 50, clearOnLogout: false },
        };
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify(stored));
        const loaded = loadAssistantSettings();
        expect(loaded.providers.map(provider => provider.id)).toEqual(['p-claude', 'p-ollama']);
        expect(loaded.retention).toEqual(getDefaultAssistantSettings().retention);
    });

    it('still resets everything on a version mismatch', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...withProviders(), version: 2 }));
        expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
    });
});
