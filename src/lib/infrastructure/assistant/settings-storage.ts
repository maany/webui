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

export const AssistantSettingsSchema: z.ZodType<AssistantSettings> = z.object({
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
    retention: z.object({ maxAgeDays: z.number().int().positive(), maxTotalMB: z.number().positive(), clearOnLogout: z.boolean() }),
});

const SessionKeysSchema = z.record(z.string(), z.string());

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

/** zod-validated; resets to the defaults on a missing entry, version mismatch, invalid JSON or schema violation. */
export function loadAssistantSettings(): AssistantSettings {
    if (!isBrowser()) return getDefaultAssistantSettings();
    try {
        const raw = localStorage.getItem(ASSISTANT_SETTINGS_KEY);
        if (!raw) return getDefaultAssistantSettings();
        const parsed = AssistantSettingsSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return getDefaultAssistantSettings();
        const settings = parsed.data;
        if (settings.keyStorage !== 'session') return settings;
        const keys = readSessionKeys();
        return {
            ...settings,
            providers: settings.providers.map(provider =>
                Object.prototype.hasOwnProperty.call(keys, provider.id) ? { ...provider, apiKey: keys[provider.id] } : provider,
            ),
        };
    } catch {
        return getDefaultAssistantSettings();
    }
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
            // The key-free entry goes first: if it cannot be written, drop the old entry so a plaintext key never stays behind.
            try {
                localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...settings, providers: settings.providers.map(withoutKey) }));
            } catch (error) {
                localStorage.removeItem(ASSISTANT_SETTINGS_KEY);
                throw error;
            }
            sessionStorage.setItem(ASSISTANT_SESSION_KEYS_KEY, JSON.stringify(keys));
        } else {
            sessionStorage.removeItem(ASSISTANT_SESSION_KEYS_KEY);
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
}
