import { z } from 'zod';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { createToolFilterMiddleware } from '@/lib/infrastructure/assistant/tanstack-tools';

const tool = (name: string): RegisteredTool<Record<string, never>> => ({
    spec: {
        name,
        domain: 'core',
        description: name,
        input: z.object({}),
        risk: 'read',
        requires: { flags: [] },
        executor: 'meta',
        output: 'object',
        describeCall: () => name,
    },
    execute: async () => ({}),
});

type Middleware = ReturnType<typeof createToolFilterMiddleware>;
type OnConfig = NonNullable<Middleware['onConfig']>;

/** Runs onConfig once with a config offering `names` and returns the names it keeps. */
async function offered(middleware: Middleware, names: string[]): Promise<string[]> {
    const config = { messages: [], systemPrompts: [], tools: names.map(name => ({ name, description: name })) } as unknown as Parameters<OnConfig>[1];
    const result = (await (middleware.onConfig as OnConfig)({} as Parameters<OnConfig>[0], config)) as { tools: { name: string }[] };
    return result.tools.map(t => t.name);
}

describe('createToolFilterMiddleware with a live tool list', () => {
    it('keeps tools loaded mid-turn when the filter allows them', async () => {
        const live = [tool('find_tools'), tool('activate_skill')];
        const allowed = new Set(['find_tools', 'activate_skill', 'list_rules']);
        const middleware = createToolFilterMiddleware(
            all => all.filter(t => allowed.has(t.spec.name)),
            () => live,
        );

        expect(await offered(middleware, ['find_tools', 'activate_skill'])).toEqual(['find_tools', 'activate_skill']);
        // find_tools loaded list_rules and run_sql: the refresh middleware offers them and deps().tools holds them.
        live.push(tool('list_rules'), tool('run_sql'));
        expect(await offered(middleware, ['find_tools', 'activate_skill', 'list_rules', 'run_sql'])).toEqual([
            'find_tools',
            'activate_skill',
            'list_rules',
        ]);
        // A skill narrows further before the next model call.
        allowed.delete('list_rules');
        expect(await offered(middleware, ['find_tools', 'activate_skill', 'list_rules', 'run_sql'])).toEqual(['find_tools', 'activate_skill']);
    });

    it('still accepts a fixed list', async () => {
        const middleware = createToolFilterMiddleware(all => all.filter(t => t.spec.name !== 'run_sql'), [tool('list_rules'), tool('run_sql')]);
        expect(await offered(middleware, ['list_rules', 'run_sql'])).toEqual(['list_rules']);
    });
});
