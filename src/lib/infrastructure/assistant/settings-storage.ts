import { z } from 'zod';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { BYOK_PROVIDER_KINDS, type ProviderConfig } from '@/lib/core/entity/assistant/provider-config';
import { TOOL_POLICIES } from '@/lib/core/entity/assistant/tool';

/**
 * Rucio bot settings in localStorage (tips-storage pattern plus a zod parse).
 * With keyStorage 'session', provider API keys live in sessionStorage only (cleared when the tab closes).
 */
export const ASSISTANT_SETTINGS_KEY = 'rucio_assistant_settings';
export const ASSISTANT_SESSION_KEYS_KEY = 'rucio_assistant_session_keys';
export const ASSISTANT_SESSION_SINK_KEY = 'rucio_assistant_session_sink';
const STORAGE_VERSION = 1;

const PricingSchema = z.object({
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    cachedInputPerMTok: z.number().nonnegative().optional(),
});

const ProviderSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(BYOK_PROVIDER_KINDS),
    label: z.string(),
    baseURL: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().min(1),
    contextWindow: z.number().int().positive().optional(),
    pricing: PricingSchema.optional(),
});

const UserSkillSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    body: z.string(),
    allowedTools: z.array(z.string()).optional(),
    importedAt: z.string(),
});

const TelemetrySinkSchema = z.object({
    kind: z.enum(['langfuse', 'otlp']),
    endpoint: z.string(),
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
});

const SettingsObjectSchema = z.object({
    version: z.literal(STORAGE_VERSION),
    providers: z.array(ProviderSchema),
    activeProviderId: z.string().min(1),
    keyStorage: z.enum(['local', 'session']),
    toolPolicies: z.record(z.string(), z.enum(TOOL_POLICIES)),
    skills: z.object({ enabled: z.record(z.string(), z.boolean()), user: z.array(UserSkillSchema) }),
    telemetry: z.object({
        sink: TelemetrySinkSchema.optional(),
        contentLevel: z.enum(['metadata', 'full']),
        enabled: z.boolean(),
        // Opt-in for operator trace export; settings saved before this field existed parse to false.
        shareWithOperator: z.boolean().default(false),
    }),
    display: z.object({ detail: z.enum(['compact', 'verbose']) }),
    retention: z.object({
        maxAgeDays: z.number().int().min(1).max(3650),
        maxTotalMB: z.number().int().min(1).max(1024),
        clearOnLogout: z.boolean(),
    }),
});

export const AssistantSettingsSchema: z.ZodType<AssistantSettings> = SettingsObjectSchema;

const SessionKeysSchema = z.record(z.string(), z.string());
const SinkSecretsSchema = z.object({
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
});
type SinkSecrets = z.infer<typeof SinkSecretsSchema>;
type TelemetrySink = z.infer<typeof TelemetrySinkSchema>;

function readSessionSinkSecrets(): SinkSecrets {
    try {
        const raw = sessionStorage.getItem(ASSISTANT_SESSION_SINK_KEY);
        if (!raw) return {};
        const parsed = SinkSecretsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : {};
    } catch {
        return {};
    }
}

function splitSinkSecrets(sink: TelemetrySink): { publicSink: TelemetrySink; secrets: SinkSecrets } {
    const { publicKey, secretKey, headers, ...publicSink } = sink;
    return { publicSink: publicSink as TelemetrySink, secrets: { publicKey, secretKey, headers } };
}

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

export function getDefaultAssistantSettings(): AssistantSettings {
    return {
        version: STORAGE_VERSION,
        providers: [],
        activeProviderId: 'operator',
        keyStorage: 'local',
        toolPolicies: {},
        skills: { enabled: {}, user: [] },
        telemetry: { contentLevel: 'metadata', enabled: false, shareWithOperator: false },
        display: { detail: 'compact' },
        retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
    };
}

function readSessionKeys(): Record<string, string> {
    try {
        const raw = sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY);
        if (!raw) return {};
        const parsed = SessionKeysSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : {};
    } catch {
        return {};
    }
}

/**
 * Parses each top-level section on its own and keeps the valid ones, so one bad field
 * (for example a hand-edited retention value) does not reset providers and keys.
 * Providers and user skills that fail individually are dropped. An active provider that
 * is no longer there falls back to the first remaining provider, else to 'operator' (which
 * resolves to the operator model, or to the "no provider" message when there is none).
 */
function salvageSettings(value: unknown): AssistantSettings | undefined {
    if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== STORAGE_VERSION) return undefined;
    const stored = value as Record<string, unknown>;
    const result: Record<string, unknown> = { ...getDefaultAssistantSettings() };
    for (const key of Object.keys(SettingsObjectSchema.shape) as (keyof typeof SettingsObjectSchema.shape)[]) {
        if (key === 'version') continue;
        if (key === 'providers') {
            if (Array.isArray(stored.providers)) {
                result.providers = stored.providers.flatMap(item => {
                    const provider = ProviderSchema.safeParse(item);
                    return provider.success ? [provider.data] : [];
                });
            }
            continue;
        }
        if (key === 'skills') {
            result.skills = salvageSkills(stored.skills);
            continue;
        }
        const section = SettingsObjectSchema.shape[key].safeParse(stored[key]);
        if (section.success) result[key] = section.data;
    }
    const providers = result.providers as ProviderConfig[];
    const active = result.activeProviderId;
    if (active !== 'operator' && !providers.some(provider => provider.id === active)) {
        result.activeProviderId = providers[0]?.id ?? 'operator';
    }
    return result as unknown as AssistantSettings;
}

function salvageSkills(value: unknown): AssistantSettings['skills'] {
    const skills: AssistantSettings['skills'] = { enabled: {}, user: [] };
    if (typeof value !== 'object' || value === null) return skills;
    const { enabled, user } = value as { enabled?: unknown; user?: unknown };
    if (typeof enabled === 'object' && enabled !== null && !Array.isArray(enabled)) {
        for (const [name, on] of Object.entries(enabled)) if (typeof on === 'boolean') skills.enabled[name] = on;
    }
    if (Array.isArray(user)) {
        skills.user = user.flatMap(item => {
            const skill = UserSkillSchema.safeParse(item);
            return skill.success ? [skill.data] : [];
        });
    }
    return skills;
}

/** zod-validated; salvages valid sections of a partly invalid entry, resets to the defaults on a missing entry, version mismatch or invalid JSON. */
export function loadAssistantSettings(): AssistantSettings {
    if (!isBrowser()) return getDefaultAssistantSettings();
    try {
        const raw = localStorage.getItem(ASSISTANT_SETTINGS_KEY);
        if (!raw) return getDefaultAssistantSettings();
        const json: unknown = JSON.parse(raw);
        const parsed = AssistantSettingsSchema.safeParse(json);
        const settings = parsed.success ? parsed.data : salvageSettings(json);
        if (!settings) return getDefaultAssistantSettings();
        if (settings.keyStorage !== 'session') return settings;
        const keys = readSessionKeys();
        if (!parsed.success) dropOrphanedSessionKeys(keys, settings.providers);
        const sink = settings.telemetry.sink;
        return {
            ...settings,
            telemetry: sink ? { ...settings.telemetry, sink: { ...sink, ...readSessionSinkSecrets() } } : settings.telemetry,
            providers: settings.providers.map(provider =>
                Object.prototype.hasOwnProperty.call(keys, provider.id) ? { ...provider, apiKey: keys[provider.id] } : provider,
            ),
        };
    } catch {
        return getDefaultAssistantSettings();
    }
}

/** After a salvage dropped providers, their keys must not linger in sessionStorage. */
function dropOrphanedSessionKeys(keys: Record<string, string>, providers: ProviderConfig[]): void {
    const kept = Object.fromEntries(Object.entries(keys).filter(([id]) => providers.some(provider => provider.id === id)));
    if (Object.keys(kept).length === Object.keys(keys).length) return;
    try {
        sessionStorage.setItem(ASSISTANT_SESSION_KEYS_KEY, JSON.stringify(kept));
    } catch {
        // Best effort: the orphaned keys are never read again.
    }
    for (const id of Object.keys(keys)) if (!(id in kept)) delete keys[id];
}

function withoutKey(provider: ProviderConfig): ProviderConfig {
    const copy = { ...provider };
    delete copy.apiKey;
    return copy;
}

/** API keys go to sessionStorage when keyStorage === 'session'; otherwise everything goes to localStorage. */
export function saveAssistantSettings(settings: AssistantSettings): void {
    if (!isBrowser()) return;
    try {
        if (settings.keyStorage === 'session') {
            const keys: Record<string, string> = {};
            settings.providers.forEach(provider => {
                if (provider.apiKey) keys[provider.id] = provider.apiKey;
            });
            const sink = settings.telemetry.sink;
            const split = sink ? splitSinkSecrets(sink) : undefined;
            const telemetry = split ? { ...settings.telemetry, sink: split.publicSink } : settings.telemetry;
            // The secret-free entry goes first: if it cannot be written, drop the old entry so a plaintext secret never stays behind.
            try {
                localStorage.setItem(
                    ASSISTANT_SETTINGS_KEY,
                    JSON.stringify({ ...settings, telemetry, providers: settings.providers.map(withoutKey) }),
                );
            } catch (error) {
                localStorage.removeItem(ASSISTANT_SETTINGS_KEY);
                throw error;
            }
            sessionStorage.setItem(ASSISTANT_SESSION_KEYS_KEY, JSON.stringify(keys));
            if (split) sessionStorage.setItem(ASSISTANT_SESSION_SINK_KEY, JSON.stringify(split.secrets));
            else sessionStorage.removeItem(ASSISTANT_SESSION_SINK_KEY);
        } else {
            sessionStorage.removeItem(ASSISTANT_SESSION_KEYS_KEY);
            sessionStorage.removeItem(ASSISTANT_SESSION_SINK_KEY);
            localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify(settings));
        }
    } catch {
        // Never log the settings: they can contain API keys.
        console.error('Failed to save assistant settings');
    }
}

export function clearAssistantSettings(): void {
    if (!isBrowser()) return;
    // Each storage in its own block so keys cannot outlive a clear when the other one throws.
    try {
        localStorage.removeItem(ASSISTANT_SETTINGS_KEY);
    } catch {
        console.error('Failed to clear assistant settings');
    }
    try {
        sessionStorage.removeItem(ASSISTANT_SESSION_KEYS_KEY);
    } catch {
        console.error('Failed to clear assistant settings');
    }
    try {
        sessionStorage.removeItem(ASSISTANT_SESSION_SINK_KEY);
    } catch {
        console.error('Failed to clear assistant settings');
    }
}
