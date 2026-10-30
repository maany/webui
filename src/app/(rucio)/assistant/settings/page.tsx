import { requireFeature } from '@/lib/infrastructure/feature-flags/require-feature';
import { AssistantSettings } from '@/component-library/features/assistant/settings/AssistantSettings';

export default async function Page() {
    await requireFeature('assistant');
    return (
        <main className="min-h-screen bg-neutral-0 dark:bg-neutral-900 transition-colors duration-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
                <AssistantSettings />
            </div>
        </main>
    );
}

export const metadata = {
    title: 'Rucio bot settings - Rucio',
};
