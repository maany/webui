import type { RegisteredTool } from './tool-types';

/**
 * Process-wide tool registry. Phase 1b ships it empty; later phases call
 * registerTools() from their tool modules. Names are unique: a second
 * registration with the same name replaces the first.
 */
const registry = new Map<string, RegisteredTool<any>>();

export function registerTools(tools: RegisteredTool<any>[]): void {
    for (const tool of tools) {
        registry.set(tool.spec.name, tool);
    }
}

export function allTools(): RegisteredTool<any>[] {
    return Array.from(registry.values());
}

export function getTool(name: string): RegisteredTool<any> | undefined {
    return registry.get(name);
}

/** Test helper: empties the registry. */
export function resetToolRegistryForTests(): void {
    registry.clear();
}
