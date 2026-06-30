import { StoryFn, Meta } from '@storybook/nextjs';
import { fixtureSuspiciousReplicaViewModel } from '@/test/fixtures/table-fixtures';
import { ListSuspiciousReplicas } from '@/component-library/pages/Replica/suspicious/ListSuspiciousReplicas';
import { ToastedTemplate } from '@/component-library/templates/ToastedTemplate/ToastedTemplate';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export default {
    title: 'Components/Pages/Replica/ListSuspiciousReplicas',
    component: ListSuspiciousReplicas,
    parameters: {
        docs: { disable: true },
    },
} as Meta<typeof ListSuspiciousReplicas>;

const Template: StoryFn<typeof ListSuspiciousReplicas> = args => {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <ToastedTemplate>
                <ListSuspiciousReplicas {...args} />
            </ToastedTemplate>
        </QueryClientProvider>
    );
};

/** Empty grid — no initial data and no streaming endpoint. */
export const Empty = Template.bind({});
Empty.args = {
    featureDDMDashboard: false,
};

/** Grid pre-populated with static mock data (no network calls). */
export const WithData = Template.bind({});
WithData.args = {
    initialData: Array.from({ length: 30 }, () => fixtureSuspiciousReplicaViewModel()),
    featureDDMDashboard: false,
};

/**
 * Multi-select filter test (for #789): 30 rows split evenly across three RSEs
 * (10 each). Each row keeps a faker-random scope/name/count so the grid looks
 * realistic, but the RSE column has only three distinct, repeated values so you
 * can filter to an exact, countable subset.
 *
 * How to verify the "Select All scopes to filtered rows" fix:
 *   1. Open the RSE column filter and type "DESY-ZN_DATADISK" so only those 10
 *      rows remain visible.
 *   2. Click the header checkbox (top-left of the grid).
 *   3. The bulk toolbar should read "10 replicas selected", not 30. Before the
 *      fix it selected all 30 rows, including the filtered-out ones.
 *   4. Clear the filter: the 20 previously-hidden rows reappear unselected,
 *      confirming the action only ever targeted the visible subset.
 */
const RSE_GROUPS = ['DESY-ZN_DATADISK', 'CERN-PROD_DATADISK', 'BNL-OSG2_DATADISK'];
export const MultiSelectFilterTest = Template.bind({});
MultiSelectFilterTest.args = {
    initialData: RSE_GROUPS.flatMap(rse =>
        Array.from({ length: 10 }, () => ({
            ...fixtureSuspiciousReplicaViewModel(),
            rse,
        })),
    ),
    featureDDMDashboard: false,
};

/** DDM Dashboard button visible in every row (FEATURE_DDM_DASHBOARD=true). */
export const WithDDMDashboardEnabled = Template.bind({});
WithDDMDashboardEnabled.args = {
    initialData: Array.from({ length: 30 }, () => fixtureSuspiciousReplicaViewModel()),
    featureDDMDashboard: true,
};

/** DDM Dashboard button hidden (FEATURE_DDM_DASHBOARD=false). */
export const WithDDMDashboardDisabled = Template.bind({});
WithDDMDashboardDisabled.args = {
    initialData: Array.from({ length: 30 }, () => fixtureSuspiciousReplicaViewModel()),
    featureDDMDashboard: false,
};

/**
 * Demonstrates the 'Reason' column with a mix of populated and absent values.
 * Half the rows carry an explicit non-empty reason so operators can verify the
 * column renders text correctly; the other half have no reason to confirm the
 * cell stays blank without errors.
 */
export const WithReason = Template.bind({});
WithReason.args = {
    initialData: Array.from({ length: 30 }, (_, i) => ({
        ...fixtureSuspiciousReplicaViewModel(),
        reason: i % 2 === 0 ? 'Checksum mismatch detected during verification scan' : undefined,
    })),
    featureDDMDashboard: false,
};
