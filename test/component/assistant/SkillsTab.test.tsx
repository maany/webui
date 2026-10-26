import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsTab, type SkillsTabProps } from '@/component-library/features/assistant/settings/SkillsTab';
import { SkillsTabContainer } from '@/component-library/features/assistant/settings/SkillsTabContainer';
import { resolveSkillCatalog } from '@/lib/infrastructure/assistant/skill-source';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';

jest.mock('@/lib/infrastructure/assistant/docs-index-meta', () => ({
    loadDocsIndexMetadata: jest.fn(async () => ({
        docsVersion: '566bee0ff5471bab2c05e5fc0f9a77f7a5df2ecb',
        docsCommitDate: '2026-10-19T14:25:25Z',
        openapiVersion: '41.0.0rc1',
        openapiSha256: 'abc',
        builtAt: '2026-10-25T12:00:00.000Z',
        chunkCount: 794,
        minisearchVersion: '7.2.0',
    })),
}));

const entries = resolveSkillCatalog({
    shipped: [
        { name: 'rse-expression-basics', description: 'RSE expressions.', body: 'b', allowedTools: ['list_rses'], source: 'shipped' },
        { name: 'diagnosing-stuck-rules', description: 'Stuck rules.', body: 'b', source: 'shipped' },
    ],
    operator: [{ name: 'rse-expression-basics', description: 'Site specific expressions.', body: 'b', source: 'operator' }],
    user: [{ name: 'my-notes', description: 'My notes.', body: 'b', importedAt: '2026-10-25T00:00:00.000Z' }],
    enabled: { 'diagnosing-stuck-rules': false },
});

const VALID = '---\nname: new-skill\ndescription: A new skill.\n---\nDo it.';

function renderTab(overrides: Partial<SkillsTabProps> = {}) {
    const props: SkillsTabProps = {
        entries,
        docs: {
            docsVersion: '566bee0ff5471bab2c05e5fc0f9a77f7a5df2ecb',
            docsCommitDate: '2026-10-19T14:25:25Z',
            openapiVersion: '41.0.0rc1',
            openapiSha256: 'abc',
            builtAt: '2026-10-25T12:00:00.000Z',
            chunkCount: 794,
            minisearchVersion: '7.2.0',
        },
        onToggle: jest.fn(),
        onImport: jest.fn(() => ({
            ok: true as const,
            replaced: false,
            warnings: [],
            skill: { name: 'new-skill', description: 'A new skill.', body: 'Do it.', importedAt: '2026-10-25T00:00:00.000Z' },
        })),
        onDelete: jest.fn(),
        ...overrides,
    };
    render(<SkillsTab {...props} />);
    return props;
}

describe('SkillsTab', () => {
    it('shows the pinned docs version', () => {
        renderTab();
        expect(screen.getByText('Rucio documentation 566bee0 (2026-10-19), REST API 41.0.0rc1. Index built 2026-10-25.')).toBeInTheDocument();
    });

    it('labels sources and explains collisions', () => {
        renderTab();
        expect(screen.getAllByText('Shipped')).toHaveLength(2);
        expect(screen.getByText('Operator')).toBeInTheDocument();
        expect(screen.getByText('User')).toBeInTheDocument();
        expect(screen.getByText('Replaces the shipped skill with the same name.')).toBeInTheDocument();
        expect(screen.getByText('Hidden by the operator skill with the same name.')).toBeInTheDocument();
        expect(screen.getByText('Limits tools to: list_rses')).toBeInTheDocument();
    });

    it('toggles skills, disables shadowed ones and deletes user skills only', async () => {
        const props = renderTab();
        const user = userEvent.setup();
        const stuck = screen.getByRole('checkbox', { name: 'Enable diagnosing-stuck-rules' });
        expect(stuck).not.toBeChecked();
        await user.click(stuck);
        expect(props.onToggle).toHaveBeenCalledWith('diagnosing-stuck-rules', true);

        const switches = screen.getAllByRole('checkbox', { name: 'Enable rse-expression-basics' });
        expect(switches.filter(s => (s as HTMLButtonElement).disabled)).toHaveLength(1);

        expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'Delete my-notes' }));
        expect(props.onDelete).toHaveBeenCalledWith('my-notes');
    });

    it('imports a pasted skill and reports success', async () => {
        const props = renderTab();
        const user = userEvent.setup();
        const importButton = screen.getByRole('button', { name: 'Import' });
        expect(importButton).toBeDisabled();
        await user.click(screen.getByLabelText('SKILL.md'));
        await user.paste(VALID);
        await user.click(importButton);
        expect(props.onImport).toHaveBeenCalledWith(VALID);
        expect(screen.getByRole('alert')).toHaveTextContent('Imported new-skill.');
        expect(screen.getByLabelText('SKILL.md')).toHaveValue('');
    });

    it('imports a .md file and shows validation errors', async () => {
        const props = renderTab({
            onImport: jest.fn(() => ({ ok: false as const, errorType: 'invalid_skill' as const, errors: ['description is required'] })),
        });
        const user = userEvent.setup();
        const file = new File(['---\nname: bad\n---\nBody'], 'SKILL.md', { type: 'text/markdown' });
        await user.upload(screen.getByLabelText('Import a SKILL.md file'), file);
        await waitFor(() => expect(props.onImport).toHaveBeenCalledWith('---\nname: bad\n---\nBody'));
        expect(screen.getByRole('alert')).toHaveTextContent('Could not import the skill: description is required.');
    });

    it('rejects a file over 32 KB without reading it', async () => {
        const props = renderTab();
        const user = userEvent.setup();
        const big = new File(['a'.repeat(32 * 1024 + 1)], 'SKILL.md', { type: 'text/markdown' });
        await user.upload(screen.getByLabelText('Import a SKILL.md file'), big);
        expect(await screen.findByRole('alert')).toHaveTextContent('That file is larger than 32 KB.');
        expect(props.onImport).not.toHaveBeenCalled();
    });

    it('reports a file that cannot be read', async () => {
        const spy = jest.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
            setTimeout(() => this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>), 0);
        });
        try {
            const props = renderTab();
            const user = userEvent.setup();
            await user.upload(screen.getByLabelText('Import a SKILL.md file'), new File(['x'], 'SKILL.md'));
            expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the file.');
            expect(props.onImport).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    it('avoids em dashes in its copy', () => {
        renderTab();
        expect(document.body.textContent).not.toContain('\u2014');
    });
});

describe('SkillsTabContainer', () => {
    it('reads settings and operator skills, and saves toggles and imports', async () => {
        let settings = { version: 1, skills: { enabled: {}, user: [] } } as unknown as AssistantSettings;
        const onUpdate = jest.fn((patch: (s: AssistantSettings) => AssistantSettings) => {
            settings = patch(settings);
        });
        const config = {
            operatorSkills: [{ name: 'atlas-naming', description: 'ATLAS DID names.', body: 'b', source: 'operator' }],
        } as unknown as AssistantConfig;
        const user = userEvent.setup();
        render(<SkillsTabContainer config={config} settings={settings} onUpdate={onUpdate} />);

        expect(await screen.findByText(/REST API 41\.0\.0rc1/)).toBeInTheDocument();
        expect(screen.getByText('atlas-naming')).toBeInTheDocument();
        expect(screen.getByText('creating-replication-rules')).toBeInTheDocument();

        await user.click(screen.getByRole('checkbox', { name: 'Enable atlas-naming' }));
        expect(settings.skills.enabled).toEqual({ 'atlas-naming': false });

        await user.click(screen.getByLabelText('SKILL.md'));
        await user.paste(VALID);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(settings.skills.user.map(s => s.name)).toEqual(['new-skill']);
    });
});
