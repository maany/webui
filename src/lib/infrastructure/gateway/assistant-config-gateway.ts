import { inject, injectable } from 'inversify';
import { z } from 'zod';
import type EnvConfigGatewayOutputPort from '@/lib/core/port/secondary/env-config-gateway-output-port';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import type { AssistantRelayConfig, AssistantTelemetryRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { parseOtlpHeaders } from '@/lib/infrastructure/assistant/otlp-headers';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig, type TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import {
    BYOK_PROVIDER_KINDS,
    type ByokProviderKind,
    type ModelPricing,
    type OperatorProviderInfo,
} from '@/lib/core/entity/assistant/provider-config';
import { TOOL_POLICIES, type ToolPolicy } from '@/lib/core/entity/assistant/tool';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import { loadOperatorSkills } from '@/lib/infrastructure/assistant/operator-skills-loader';

/** Every operator variable of spec section 5.2, plus ASSISTANT_TELEMETRY_USER_SALT (server-only). */
export const ASSISTANT_ENV_KEYS = [
    'ASSISTANT_WRITE_POLICY_CAP',
    'ASSISTANT_HIGH_RISK_POLICY_CAP',
    'ASSISTANT_ALLOW_BYOK',
    'ASSISTANT_ALLOWED_PROVIDER_KINDS',
    'ASSISTANT_DEFAULT_PROVIDER_KIND',
    'ASSISTANT_DEFAULT_BASE_URL',
    'ASSISTANT_DEFAULT_API_KEY',
    'ASSISTANT_DEFAULT_MODEL',
    'ASSISTANT_DEFAULT_MODEL_LABEL',
    'ASSISTANT_DEFAULT_CONTEXT_WINDOW',
    'ASSISTANT_SKILLS_DIR',
    'ASSISTANT_TELEMETRY_OTLP_ENDPOINT',
    'ASSISTANT_TELEMETRY_OTLP_HEADERS',
    'ASSISTANT_TELEMETRY_ALLOW_USER_SINKS',
    'ASSISTANT_TELEMETRY_CONTENT_CAP',
    'ASSISTANT_TELEMETRY_HASH_USER',
    'ASSISTANT_TELEMETRY_USER_SALT',
    'ASSISTANT_PRICES_JSON',
    'ASSISTANT_RELAY_RATE_LIMIT',
    'ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS',
] as const;

type AssistantEnvKey = (typeof ASSISTANT_ENV_KEYS)[number];
type AssistantEnv = Partial<Record<AssistantEnvKey, string>>;

const DEFAULT_RELAY_RATE_LIMIT = 30;
const MAX_RELAY_RATE_LIMIT = 10_000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000;
const MAX_UPSTREAM_TIMEOUT_MS = 3_600_000;
/** ASSISTANT_TELEMETRY_USER_SALT shorter than this (after trimming) is treated as missing. */
export const MIN_TELEMETRY_USER_SALT_LENGTH = 16;
const MAX_CONTEXT_WINDOW = 100_000_000;
const OPERATOR_KINDS: readonly OperatorProviderInfo['kind'][] = ['openai-compatible', 'anthropic'];
const HIGH_RISK_CAPS: readonly Exclude<ToolPolicy, 'allow'>[] = ['deny', 'ask'];
const CONTENT_LEVELS: readonly TelemetryContentLevel[] = ['metadata', 'full'];
const TRUE_VALUES = ['true', '1', 'yes', 'on'];
const FALSE_VALUES = ['false', '0', 'no', 'off'];

const PricesSchema = z.record(
    z.string().min(1),
    z.object({
        inputPerMTok: z.number().nonnegative(),
        outputPerMTok: z.number().nonnegative(),
        cachedInputPerMTok: z.number().nonnegative().optional(),
    }),
);

function clean(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function parseChoice<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
    const normalised = clean(value)?.toLowerCase();
    return normalised !== undefined && (allowed as readonly string[]).includes(normalised) ? (normalised as T) : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    const normalised = clean(value)?.toLowerCase();
    if (normalised === undefined) return fallback;
    if (TRUE_VALUES.includes(normalised)) return true;
    if (FALSE_VALUES.includes(normalised)) return false;
    return fallback;
}

function parsePositiveInt(value: string | undefined, max: number): number | undefined {
    const normalised = clean(value);
    if (normalised === undefined || !/^\d+$/.test(normalised)) return undefined;
    const parsed = Number(normalised);
    return parsed > 0 && parsed <= max ? parsed : undefined;
}

function parseHttpUrl(value: string | undefined): string | undefined {
    const normalised = clean(value);
    if (normalised === undefined) return undefined;
    try {
        const url = new URL(normalised);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return normalised.replace(/\/+$/, '');
    } catch {
        return undefined;
    }
}

function parseKinds(value: string | undefined): ByokProviderKind[] {
    const normalised = clean(value);
    const fallback = [...DEFAULT_ASSISTANT_CONFIG.allowedProviderKinds];
    if (normalised === undefined) return fallback;
    const kinds: ByokProviderKind[] = [];
    normalised.split(',').forEach(part => {
        const kind = part.trim().toLowerCase();
        if ((BYOK_PROVIDER_KINDS as readonly string[]).includes(kind) && !kinds.includes(kind as ByokProviderKind)) {
            kinds.push(kind as ByokProviderKind);
        }
    });
    return kinds.length > 0 ? kinds : fallback;
}

function parsePrices(value: string | undefined): Record<string, ModelPricing> | undefined {
    const normalised = clean(value);
    if (normalised === undefined) return undefined;
    try {
        const parsed = PricesSchema.safeParse(JSON.parse(normalised));
        if (parsed.success) return parsed.data;
    } catch {
        // invalid JSON: reported below
    }
    console.warn('ASSISTANT_PRICES_JSON is not a JSON object of model prices, ignoring it');
    return undefined;
}

interface OperatorDefault extends OperatorProviderInfo {
    baseURL: string;
}

function parseOperatorDefault(env: AssistantEnv): OperatorDefault | undefined {
    const baseURL = parseHttpUrl(env.ASSISTANT_DEFAULT_BASE_URL);
    const model = clean(env.ASSISTANT_DEFAULT_MODEL);
    if (baseURL === undefined || model === undefined) return undefined;
    const contextWindow = parsePositiveInt(env.ASSISTANT_DEFAULT_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW);
    return {
        kind: parseChoice(env.ASSISTANT_DEFAULT_PROVIDER_KIND, OPERATOR_KINDS, 'openai-compatible'),
        model,
        label: clean(env.ASSISTANT_DEFAULT_MODEL_LABEL) ?? model,
        baseURL,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
    };
}

/** The deployment secret for hashing user ids in operator traces, or undefined when missing or too short. */
function parseUserSalt(value: string | undefined): string | undefined {
    const normalised = clean(value);
    return normalised !== undefined && normalised.length >= MIN_TELEMETRY_USER_SALT_LENGTH ? normalised : undefined;
}

let warnedAboutUserSalt = false;

/** Clears the once-per-process warning flag. Tests only. */
export function resetAssistantConfigWarnings(): void {
    warnedAboutUserSalt = false;
}

/**
 * The operator sink is only usable when the endpoint is a valid http(s) URL and, with hashUser on,
 * a valid salt exists (operator traces never carry an unsalted or raw user id). Warns once per process
 * when an endpoint is configured but the export is off because the salt is missing or too short.
 */
function parseOperatorSink(env: AssistantEnv, hashUser: boolean): boolean {
    if (parseHttpUrl(env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT) === undefined) return false;
    if (!hashUser || parseUserSalt(env.ASSISTANT_TELEMETRY_USER_SALT) !== undefined) return true;
    if (!warnedAboutUserSalt) {
        warnedAboutUserSalt = true;
        console.warn(
            `ASSISTANT_TELEMETRY_HASH_USER is on but ASSISTANT_TELEMETRY_USER_SALT is missing or shorter than ${MIN_TELEMETRY_USER_SALT_LENGTH} characters, operator trace export is off`,
        );
    }
    return false;
}

async function readAssistantEnv(envConfigGateway: EnvConfigGatewayOutputPort): Promise<AssistantEnv> {
    const env: AssistantEnv = {};
    for (const key of ASSISTANT_ENV_KEYS) {
        const value = await envConfigGateway.get(key);
        if (value !== undefined) env[key] = value;
    }
    return env;
}

/**
 * Reads the Rucio bot operator settings (ASSISTANT_* env) through the env config gateway.
 * Parsing never throws: invalid values fall back to the defaults of DEFAULT_ASSISTANT_CONFIG.
 */
@injectable()
class AssistantConfigGateway implements AssistantConfigGatewayOutputPort {
    constructor(@inject(GATEWAYS.ENV_CONFIG) private readonly envConfigGateway: EnvConfigGatewayOutputPort) {}

    async getAssistantConfig(): Promise<AssistantConfig> {
        const env = await readAssistantEnv(this.envConfigGateway);
        const operator = parseOperatorDefault(env);
        const prices = parsePrices(env.ASSISTANT_PRICES_JSON);
        const hashUser = parseBool(env.ASSISTANT_TELEMETRY_HASH_USER, DEFAULT_ASSISTANT_CONFIG.telemetry.hashUser);
        const config: AssistantConfig = {
            writePolicyCap: parseChoice(env.ASSISTANT_WRITE_POLICY_CAP, TOOL_POLICIES, DEFAULT_ASSISTANT_CONFIG.writePolicyCap),
            highRiskPolicyCap: parseChoice(env.ASSISTANT_HIGH_RISK_POLICY_CAP, HIGH_RISK_CAPS, DEFAULT_ASSISTANT_CONFIG.highRiskPolicyCap),
            allowByok: parseBool(env.ASSISTANT_ALLOW_BYOK, DEFAULT_ASSISTANT_CONFIG.allowByok),
            allowedProviderKinds: parseKinds(env.ASSISTANT_ALLOWED_PROVIDER_KINDS),
            telemetry: {
                operatorSink: parseOperatorSink(env, hashUser),
                allowUserSinks: parseBool(env.ASSISTANT_TELEMETRY_ALLOW_USER_SINKS, DEFAULT_ASSISTANT_CONFIG.telemetry.allowUserSinks),
                contentCap: parseChoice(env.ASSISTANT_TELEMETRY_CONTENT_CAP, CONTENT_LEVELS, DEFAULT_ASSISTANT_CONFIG.telemetry.contentCap),
                hashUser,
            },
            // Read on every request so operators can add skills without a restart; invalid ones are logged and skipped.
            operatorSkills: await loadOperatorSkills(env.ASSISTANT_SKILLS_DIR),
        };
        if (operator) {
            config.defaultProvider = {
                kind: operator.kind,
                model: operator.model,
                label: operator.label,
                ...(operator.contextWindow !== undefined ? { contextWindow: operator.contextWindow } : {}),
            };
        }
        if (prices) config.pricesOverride = prices;
        return config;
    }

    async getRelayConfig(): Promise<AssistantRelayConfig | undefined> {
        const env = await readAssistantEnv(this.envConfigGateway);
        const operator = parseOperatorDefault(env);
        if (!operator) return undefined;
        const apiKey = clean(env.ASSISTANT_DEFAULT_API_KEY);
        return {
            kind: operator.kind,
            baseURL: operator.baseURL,
            ...(apiKey !== undefined ? { apiKey } : {}),
            rateLimitPerMinute: parsePositiveInt(env.ASSISTANT_RELAY_RATE_LIMIT, MAX_RELAY_RATE_LIMIT) ?? DEFAULT_RELAY_RATE_LIMIT,
            upstreamTimeoutMs: parsePositiveInt(env.ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS, MAX_UPSTREAM_TIMEOUT_MS) ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
        };
    }

    async getTelemetryUserSalt(): Promise<string | undefined> {
        const env = await readAssistantEnv(this.envConfigGateway);
        return parseUserSalt(env.ASSISTANT_TELEMETRY_USER_SALT);
    }

    /** Same checks as `telemetry.operatorSink`, so the relay and the browser always agree. */
    async getTelemetryRelayConfig(): Promise<AssistantTelemetryRelayConfig | undefined> {
        const env = await readAssistantEnv(this.envConfigGateway);
        const endpoint = parseHttpUrl(env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT);
        if (endpoint === undefined) return undefined;
        const hashUser = parseBool(env.ASSISTANT_TELEMETRY_HASH_USER, DEFAULT_ASSISTANT_CONFIG.telemetry.hashUser);
        const userSalt = hashUser ? await this.getTelemetryUserSalt() : undefined;
        if (hashUser && userSalt === undefined) return undefined;
        return {
            endpoint,
            headers: parseOtlpHeaders(env.ASSISTANT_TELEMETRY_OTLP_HEADERS),
            rateLimitPerMinute: parsePositiveInt(env.ASSISTANT_RELAY_RATE_LIMIT, MAX_RELAY_RATE_LIMIT) ?? DEFAULT_RELAY_RATE_LIMIT,
            hashUser,
            ...(userSalt !== undefined ? { userSalt } : {}),
        };
    }
}

export default AssistantConfigGateway;
