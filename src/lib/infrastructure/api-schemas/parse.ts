import { z } from 'zod';

export type QueryRecord = Record<string, string | string[]>;

/** Collects search params into a record; a repeated key becomes an array, in order. */
export function searchParamsToRecord(searchParams: URLSearchParams): QueryRecord {
    const record = Object.create(null) as QueryRecord;
    searchParams.forEach((value, key) => {
        if (Object.hasOwn(record, key)) {
            const existing = record[key];
            if (Array.isArray(existing)) {
                existing.push(value);
            } else {
                record[key] = [existing, value];
            }
        } else {
            record[key] = value;
        }
    });
    return record;
}

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional']);

/** Strips optional, nullable, default and similar wrappers to reach the schema that decides coercion. */
function unwrap(schema: z.ZodType): z.ZodType {
    let current = schema;
    while (WRAPPER_TYPES.has(current.def.type)) {
        // Access zod v4 internal structure for wrapper types
        current = (current.def as unknown as { innerType: z.ZodType }).innerType;
    }
    return current;
}

function coerceScalar(value: string, schema: z.ZodType): unknown {
    const type = unwrap(schema).def.type;
    if (type === 'number' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
    }
    if (type === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return value;
}

function coerceField(value: string | string[], schema: z.ZodType): unknown {
    const base = unwrap(schema);
    if (base.def.type === 'array') {
        // Access zod v4 internal structure for array type
        const element = (base.def as unknown as { element: z.ZodType }).element;
        const values = Array.isArray(value) ? value : [value];
        return values.map(item => coerceScalar(item, element));
    }
    if (Array.isArray(value)) {
        // A repeated key for a single-valued field: keep the array so validation rejects it.
        return value.map(item => coerceScalar(item, schema));
    }
    return coerceScalar(value, schema);
}

/**
 * Validates URL search params against a route's query schema.
 * Values for number and boolean fields are coerced from strings first; a single value for an
 * array field becomes a one-element array. Keys the schema does not know are passed through
 * unchanged, so the object schema decides whether to strip or reject them.
 */
export function parseQuery<S extends z.ZodObject>(schema: S, searchParams: URLSearchParams): z.ZodSafeParseResult<z.output<S>> {
    const shape = schema.shape as Record<string, z.ZodType>;
    const input: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(searchParamsToRecord(searchParams))) {
        if (Object.hasOwn(shape, key)) {
            const field = shape[key];
            input[key] = coerceField(value, field);
        } else {
            input[key] = value;
        }
    }
    return schema.safeParse(input);
}

/** The top-level field of the first validation issue, e.g. 'scope'; undefined for object-level issues. */
export function firstInvalidField(error: z.ZodError): string | undefined {
    const field = error.issues[0]?.path[0];
    return field === undefined ? undefined : String(field);
}
