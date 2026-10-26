'use client';

import * as React from 'react';
import { Button } from '@/component-library/atoms/form/button';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import { MutationDialog } from '@/component-library/features/mutations/MutationDialog';

/** Basic version: phase 1b adds conversation sizes, delete and retention here. */
export const StorageTab: React.FC<{ onReset(): void }> = ({ onReset }) => {
    const [confirming, setConfirming] = React.useState(false);
    const [cleared, setCleared] = React.useState(false);

    return (
        <section aria-labelledby="assistant-storage-heading" className="space-y-4">
            <h2 id="assistant-storage-heading" className="sr-only">
                Storage
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Rucio bot keeps your providers, API keys and preferences in this browser only.
            </p>
            <div>
                <Button
                    variant="error"
                    onClick={() => {
                        setCleared(false);
                        setConfirming(true);
                    }}
                >
                    Clear assistant settings
                </Button>
            </div>
            {cleared && <Alert variant="success" message="Assistant settings cleared." />}
            {confirming && (
                <MutationDialog
                    open
                    onOpenChange={open => {
                        if (!open) setConfirming(false);
                    }}
                    title="Clear assistant settings"
                    description="This cannot be undone."
                    onSubmit={() => {
                        onReset();
                        setConfirming(false);
                        setCleared(true);
                    }}
                    submitLabel="Clear settings"
                    submitVariant="error"
                >
                    <p className="text-sm text-neutral-900 dark:text-neutral-100">
                        Your providers, API keys and preferences will be removed from this browser.
                    </p>
                </MutationDialog>
            )}
        </section>
    );
};
