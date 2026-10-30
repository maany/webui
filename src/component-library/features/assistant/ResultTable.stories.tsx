import type { Meta, StoryObj } from '@storybook/react';
import { ResultTable } from './ResultTable';

const rows = [
    { rse_expression: 'CERN-PROD', state: 'Stuck', n: 12 },
    { rse_expression: 'BNL-OSG2_DATADISK', state: 'Stuck', n: 4 },
    { rse_expression: 'tier=1&type=DISK', state: 'Replicating', n: 31 },
];

const meta: Meta<typeof ResultTable> = {
    title: 'Features/Assistant/ResultTable',
    component: ResultTable,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    decorators: [
        Story => (
            <div className="w-[420px]">
                <Story />
            </div>
        ),
    ],
    args: { columns: ['rse_expression', 'state', 'n'], rows, totalRows: 3 },
};

export default meta;
type Story = StoryObj<typeof ResultTable>;

export const Default: Story = {};

export const ManyRows: Story = {
    args: {
        rows: Array.from({ length: 80 }, (_, index) => ({ rse_expression: `RSE_${index}`, state: index % 3 === 0 ? 'Stuck' : 'OK', n: index })),
        totalRows: 12_400,
    },
};

export const Expired: Story = {
    args: { expired: true, onRefresh: () => undefined },
};

export const Refreshing: Story = {
    args: { expired: true, refreshing: true, onRefresh: () => undefined },
};

export const WithError: Story = {
    args: { expired: true, onRefresh: () => undefined, error: 'Handle rules_1 could not be refreshed: your session has expired.' },
};

export const Empty: Story = {
    args: { rows: [], totalRows: 0 },
};
