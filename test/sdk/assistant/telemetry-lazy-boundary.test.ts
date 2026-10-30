import fs from 'fs';
import path from 'path';

/**
 * These modules load with the panel or the settings page. They may only reach the
 * OpenTelemetry SDK through a dynamic import(), so the SDK stays out of those bundles.
 */
const EAGER_MODULES = [
    'src/lib/core/services/assistant-telemetry.ts',
    'src/lib/infrastructure/assistant/otlp-headers.ts',
    'src/lib/infrastructure/assistant/telemetry-sinks.ts',
    'src/lib/infrastructure/assistant/telemetry-scrubber.ts',
    'src/lib/infrastructure/hooks/useAssistantTelemetry.tsx',
    'src/component-library/features/assistant/AssistantTelemetryBridge.tsx',
    'src/component-library/features/assistant/settings/TelemetrySettingsForm.tsx',
    'src/component-library/features/assistant/settings/TelemetryTab.tsx',
    'src/component-library/features/assistant/settings/AssistantSettingsView.tsx',
    'src/component-library/features/assistant/AssistantRoot.tsx',
];

const LAZY_TARGETS = ['@/lib/infrastructure/assistant/telemetry', '@/lib/infrastructure/assistant/telemetry-test-export'];

/** Specifiers of static imports that bring runtime values (not `import type`). */
function valueImportSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    // Static imports, side-effect imports and re-exports; a match cannot cross a statement boundary.
    for (const match of source.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
        if (!match[1]) {
            specifiers.push(match[2]);
        }
    }
    return specifiers;
}

describe('telemetry lazy loading boundary', () => {
    it.each(EAGER_MODULES)('%s has no value import of OpenTelemetry or the lazy telemetry modules', file => {
        const specifiers = valueImportSpecifiers(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
        for (const specifier of specifiers) {
            expect(specifier.startsWith('@opentelemetry/')).toBe(false);
            expect(LAZY_TARGETS).not.toContain(specifier);
        }
    });

    it('detects a value import when one is added', () => {
        expect(
            valueImportSpecifiers("import {\n    trace,\n} from '@opentelemetry/api';\nimport type { Span } from '@opentelemetry/api';\n"),
        ).toEqual(['@opentelemetry/api']);
    });

    it('detects side-effect imports and re-exports', () => {
        expect(
            valueImportSpecifiers(
                "import '@opentelemetry/api';\nimport { a } from './a';\nexport { trace } from '@opentelemetry/sdk-trace';\nexport type { Span } from '@opentelemetry/api';\nexport * from '@/lib/infrastructure/assistant/telemetry';\n",
            ),
        ).toEqual(['@opentelemetry/api', './a', '@opentelemetry/sdk-trace', '@/lib/infrastructure/assistant/telemetry']);
    });
});
