/**
 * SKILL.md parser and validator following the Agent Skills specification (https://agentskills.io/specification),
 * plus the small YAML frontmatter reader it needs (also used for Docusaurus pages by the docs index builder).
 * Runs in the browser (user imports), on the server (operator directory) and in tools/assistant scripts under
 * Node type stripping, so it must keep type-only imports and no other runtime imports.
 */
import type { SkillDefinition, SkillSourceKind } from '@/lib/core/entity/assistant/skill';

export type FrontmatterValue = string | string[] | Record<string, string>;

export interface SplitFrontmatter {
    frontmatter: string;
    body: string;
}

const FRONTMATTER_RE = /^\uFEFF?\s*---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n([\s\S]*))?$/;

export function splitFrontmatter(raw: string): SplitFrontmatter | null {
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) return null;
    return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

function indentOf(line: string): number {
    return line.length - line.trimStart().length;
}

function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\(["\\n])/g, (_m, c: string) => (c === 'n' ? '\n' : c));
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isChild(line: string | undefined): line is string {
    return line !== undefined && (line.trim() === '' || indentOf(line) > 0 || line.startsWith('- '));
}

export function parseFrontmatterBlock(block: string): Record<string, FrontmatterValue> {
    const lines = block.split(/\r?\n/);
    const out: Record<string, FrontmatterValue> = {};
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '' || line.trimStart().startsWith('#') || indentOf(line) > 0) {
            i++;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) {
            i++;
            continue;
        }
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        i++;
        const unsafe = UNSAFE_KEYS.has(key);
        const target: Record<string, FrontmatterValue> = unsafe ? {} : out;

        if (/^[>|][+-]?$/.test(value)) {
            const collected: string[] = [];
            while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
                collected.push(lines[i]);
                i++;
            }
            const nonEmpty = collected.filter(l => l.trim() !== '');
            const minIndent = nonEmpty.length ? Math.min(...nonEmpty.map(indentOf)) : 0;
            const stripped = collected.map(l => l.slice(minIndent));
            target[key] = value.startsWith('>') ? stripped.join(' ').replace(/\s+/g, ' ').trim() : stripped.join('\n').trim();
            continue;
        }

        if (value === '') {
            const items: string[] = [];
            const map: Record<string, string> = {};
            while (isChild(lines[i])) {
                const child = lines[i].trim();
                if (child.startsWith('- ')) {
                    items.push(unquote(child.slice(2).trim()));
                } else if (child.indexOf(':') > 0) {
                    const childColon = child.indexOf(':');
                    const childKey = child.slice(0, childColon).trim();
                    if (!UNSAFE_KEYS.has(childKey)) map[childKey] = unquote(child.slice(childColon + 1).trim());
                }
                i++;
            }
            target[key] = items.length > 0 ? items : Object.keys(map).length > 0 ? map : '';
            continue;
        }

        const quoted = value.startsWith('"') || value.startsWith("'");
        let scalar = value;
        if (!quoted) {
            while (i < lines.length && lines[i].trim() !== '' && indentOf(lines[i]) > 0) {
                scalar += ` ${lines[i].trim()}`;
                i++;
            }
        }
        target[key] = unquote(scalar);
    }
    return out;
}

export function frontmatterString(data: Record<string, FrontmatterValue>, key: string): string | undefined {
    const value = data[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Largest SKILL.md accepted from any source, in bytes (UTF-8). */
export const MAX_SKILL_BYTES = 32 * 1024;
export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_COMPATIBILITY_LENGTH = 500;
/** The spec recommends keeping SKILL.md under 500 lines; longer files load but produce a warning. */
export const RECOMMENDED_MAX_SKILL_LINES = 500;

/** Lowercase letters, digits and single hyphens; no leading, trailing or doubled hyphen. */
export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type ParseSkillResult = { ok: true; skill: SkillDefinition; warnings: string[] } | { ok: false; errors: string[] };

export interface ParseSkillOptions {
    source: SkillSourceKind;
    /** Directory holding the SKILL.md. When given, the name must match it (shipped and operator skills). */
    dirName?: string;
}

/** UTF-8 byte length without TextEncoder, so the parser runs in every test environment. */
export function utf8Length(text: string): number {
    let bytes = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
}

/** A tool name as the assistant registry spells it: snake case, at most 64 characters. */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** `allowed-tools` is a space separated string in the spec. Lists and commas are accepted too. */
export function parseAllowedToolsDetailed(value: FrontmatterValue | undefined): { tools: string[] | undefined; dropped: string[] } {
    if (value === undefined || value === '') return { tools: undefined, dropped: [] };
    const tokens = Array.isArray(value)
        ? value
        : typeof value === 'string'
        ? value
              .replace(/^\[|\]$/g, '')
              .split(/[\s,]+/)
              .map(t => t.replace(/^['"]|['"]$/g, ''))
        : [];
    const trimmed = tokens.map(t => t.trim()).filter(t => t !== '');
    // Only plain tool names survive: the list is shown to the model outside the untrusted fence.
    const tools = Array.from(new Set(trimmed.filter(t => TOOL_NAME_RE.test(t))));
    const dropped = Array.from(new Set(trimmed.filter(t => !TOOL_NAME_RE.test(t))));
    // A present, non-empty list is a restriction even when no name is valid (R8a): never widen it to undefined.
    return { tools: trimmed.length > 0 ? tools : undefined, dropped };
}

export function parseAllowedTools(value: FrontmatterValue | undefined): string[] | undefined {
    return parseAllowedToolsDetailed(value).tools;
}

const MAX_DROPPED_WARNING_CHARS = 200;

/** One user-facing warning naming the first few dropped tokens, with markup characters and controls removed. */
function droppedToolsWarning(dropped: string[]): string {
    // eslint-disable-next-line no-control-regex
    const safe = dropped.map(t => t.replace(/[<>&"'`\u0000-\u001f\u007f]/g, '').slice(0, 40)).filter(t => t !== '');
    let list = '';
    for (const name of safe.slice(0, 5)) {
        if ((list ? `${list}, ${name}` : name).length > MAX_DROPPED_WARNING_CHARS) break;
        list = list ? `${list}, ${name}` : name;
    }
    const more = safe.length > 0 && list.split(', ').length < safe.length ? ', ...' : '';
    return `allowed-tools ignored invalid tool names: ${list}${more}`;
}

/** Credential-shaped values (not mere words) that must never be stored in a skill. */
const CREDENTIAL_PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    // A lookbehind instead of \b: '-' is both in the token class and a \b boundary, which made repeated '-eyJ' quadratic.
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{9,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /(?<![A-Za-z0-9_-])sk-(?:[A-Za-z]+-)*[A-Za-z0-9_-]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /(?<![A-Za-z0-9_-])Bearer\s+[A-Za-z0-9._~+/=-]{20,}/,
    /X-Rucio-Auth-Token:[ \t]*[A-Za-z0-9._~+/=-]{8,}/i,
];

/** True when the text carries a credential-shaped value: a private key, JWT, API key, AWS key id, bearer token or Rucio token header. */
export function containsCredential(text: string): boolean {
    return CREDENTIAL_PATTERNS.some(pattern => pattern.test(text));
}

export function parseSkillMarkdown(raw: string, options: ParseSkillOptions): ParseSkillResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // UTF-16 length never exceeds the UTF-8 byte length, so this rejects oversized input before walking it.
    if (raw.length > MAX_SKILL_BYTES || utf8Length(raw) > MAX_SKILL_BYTES) {
        return { ok: false, errors: [`SKILL.md is larger than ${MAX_SKILL_BYTES / 1024} KB`] };
    }
    if (containsCredential(raw)) {
        return {
            ok: false,
            errors: ['SKILL.md looks like it contains a credential (an API key, token or private key); remove it first'],
        };
    }
    const split = splitFrontmatter(raw);
    if (!split) {
        return { ok: false, errors: ['SKILL.md must start with a frontmatter block between --- lines'] };
    }
    const data = parseFrontmatterBlock(split.frontmatter);

    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (name === '') errors.push('name is required');
    else if (name.length > MAX_SKILL_NAME_LENGTH) errors.push(`name must be at most ${MAX_SKILL_NAME_LENGTH} characters`);
    else if (!SKILL_NAME_RE.test(name))
        errors.push('name may only use lowercase letters, digits and single hyphens, and must not start or end with a hyphen');
    if (name !== '' && options.dirName !== undefined && name !== options.dirName) {
        errors.push(`name "${name}" must match its directory "${options.dirName}"`);
    }

    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (description === '') errors.push('description is required');
    else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) errors.push(`description must be at most ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);

    const compatibility = data.compatibility;
    if (compatibility !== undefined && (typeof compatibility !== 'string' || compatibility.length > MAX_SKILL_COMPATIBILITY_LENGTH)) {
        errors.push(`compatibility must be text of at most ${MAX_SKILL_COMPATIBILITY_LENGTH} characters`);
    }
    const metadata = data.metadata;
    if (metadata !== undefined && metadata !== '' && (typeof metadata !== 'object' || Array.isArray(metadata))) {
        errors.push('metadata must be a map of text keys to text values');
    }

    const body = split.body.trim();
    if (body === '') errors.push('the skill body after the frontmatter is empty');
    if (body.split('\n').length > RECOMMENDED_MAX_SKILL_LINES) {
        warnings.push(`the body has more than ${RECOMMENDED_MAX_SKILL_LINES} lines; consider shortening it`);
    }

    if (errors.length > 0) return { ok: false, errors };

    const { tools: allowedTools, dropped } = parseAllowedToolsDetailed(data['allowed-tools']);
    if (dropped.length > 0) warnings.push(droppedToolsWarning(dropped));
    const skill: SkillDefinition = { name, description, body, source: options.source };
    if (allowedTools) skill.allowedTools = allowedTools;
    return { ok: true, skill, warnings };
}
