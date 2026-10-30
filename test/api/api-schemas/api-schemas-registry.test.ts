import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import * as apiSchemas from '@/lib/infrastructure/api-schemas';
import { API_ROUTE_NAMES, API_SCHEMAS } from '@/lib/infrastructure/api-schemas';

const FEATURE_DIR = path.resolve(__dirname, '../../../src/app/api/feature');
const isMockRoute = (name: string) => name.startsWith('mock-') || name === 'template-stream';
const toPascal = (name: string) =>
    name
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

const routeDirs = fs
    .readdirSync(FEATURE_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(FEATURE_DIR, entry.name, 'route.ts')))
    .map(entry => entry.name)
    .filter(name => !isMockRoute(name))
    .sort();

describe('API_SCHEMAS registry', () => {
    it('has an entry for every non-mock route directory and nothing else', () => {
        expect([...API_ROUTE_NAMES].sort()).toEqual(routeDirs);
        expect(Object.keys(API_SCHEMAS).sort()).toEqual(routeDirs);
    });

    it.each(routeDirs)('%s exports <PascalName>Schema from the index and registers that same schema', name => {
        const exported = (apiSchemas as Record<string, unknown>)[`${toPascal(name)}Schema`];
        expect(exported).toBeDefined();
        expect(API_SCHEMAS[name as keyof typeof API_SCHEMAS]).toBe(exported);
    });

    it.each(routeDirs)('%s schema is a zod object that converts to JSON Schema', name => {
        const schema = API_SCHEMAS[name as keyof typeof API_SCHEMAS];
        expect(schema.def.type).toBe('object');
        expect(z.toJSONSchema(schema, { io: 'input' })).toMatchObject({ type: 'object' });
    });

    it.each(routeDirs)('%s route imports its schema module', name => {
        const source = fs.readFileSync(path.join(FEATURE_DIR, name, 'route.ts'), 'utf8');
        const schema = API_SCHEMAS[name as keyof typeof API_SCHEMAS];
        const takesNoInput = Object.keys((schema as z.ZodObject).shape).length === 0;
        if (takesNoInput) {
            expect(source).not.toContain("from 'zod'");
        } else {
            expect(source).toContain(`from '@/lib/infrastructure/api-schemas/${name}'`);
            expect(source).not.toContain("from 'zod'");
        }
    });
});
