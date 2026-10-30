import type { Meta, StoryObj } from '@storybook/nextjs';
import { SkillsTab } from './SkillsTab';
import { resolveSkillCatalog } from '@/lib/infrastructure/assistant/skill-source';
import { SHIPPED_SKILLS } from '@/lib/infrastructure/assistant/skills/shipped-skills.generated';
import { importUserSkill } from '@/lib/infrastructure/assistant/user-skills';

const entries = resolveSkillCatalog({
    shipped: SHIPPED_SKILLS,
    operator: [
        { name: 'rse-expression-basics', description: 'RSE expressions with the attributes of this deployment.', body: 'b', source: 'operator' },
    ],
    user: [
        {
            name: 'my-notes',
            description: 'Notes for my analysis datasets.',
            body: 'b',
            allowedTools: ['list_rules', 'run_sql'],
            importedAt: '2026-10-25T00:00:00.000Z',
        },
    ],
    enabled: { 'sql-recipes-over-handles': false },
});

const meta: Meta<typeof SkillsTab> = {
    title: 'Features/Assistant/Settings/SkillsTab',
    component: SkillsTab,
    tags: ['autodocs'],
    args: {
        entries,
        docs: {
            docsVersion: '566bee0ff5471bab2c05e5fc0f9a77f7a5df2ecb',
            docsCommitDate: '2026-10-19T14:25:25Z',
            openapiVersion: '41.0.0rc1',
            openapiSha256: 'ac5572e46fca5e1f1b965bda05ad8693a50ce81eb05776a9c0fc64cf396a4e27',
            builtAt: '2026-10-25T22:05:45.647Z',
            chunkCount: 794,
            minisearchVersion: '7.2.0',
        },
        onToggle: () => undefined,
        onImport: (raw: string) => importUserSkill(raw, []),
        onDelete: () => undefined,
    },
};

export default meta;
type Story = StoryObj<typeof SkillsTab>;

export const Default: Story = {};
export const DocsUnavailable: Story = { args: { docs: null } };
export const NoSkills: Story = { args: { entries: [] } };
