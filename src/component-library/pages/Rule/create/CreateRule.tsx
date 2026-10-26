import React, { useEffect, useState } from 'react';
import { CreateRuleOptions, CreateRuleParameters, CreateRuleStorage, getEmptyCreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { Heading } from '@/component-library/atoms/misc/Heading';
import Timeline from '@/component-library/features/Timeline';
import { HiArrowLeft, HiArrowRight } from 'react-icons/hi';
import { Button } from '@/component-library/atoms/form/button';
import { CreateRuleStageData } from '@/component-library/pages/Rule/create/stage-dids/CreateRuleStageData';
import { CreateRuleStageStorage } from '@/component-library/pages/Rule/create/stage-rses/CreateRuleStageStorage';
import { LoadingSpinner } from '@/component-library/atoms/loading/LoadingSpinner';
import { CreateRuleStageOptions } from '@/component-library/pages/Rule/create/stage-options/CreateRuleStageOptions';
import { CreateRuleOptionsErrors, computeOptionsErrors, getEmptyOptionsErrors } from '@/component-library/pages/Rule/create/create-rule-validation';
import { ListDIDsViewModel } from '@/lib/infrastructure/data/view-model/list-did';
import { CreateRuleStageSummary } from '@/component-library/pages/Rule/create/stage-summary/CreateRuleStageSummary';
import { CreateRuleStageSubmission } from '@/component-library/pages/Rule/create/stage-submission/CreateRuleStageSubmission';

const PreviousButton = ({ activeIndex, setActiveIndex }: { activeIndex: number; setActiveIndex: React.Dispatch<React.SetStateAction<number>> }) => {
    const disabled = activeIndex === 0;

    return (
        <Button variant="neutral" className="w-full sm:w-48 justify-between" disabled={disabled} onClick={() => setActiveIndex(prev => prev - 1)}>
            <HiArrowLeft />
            <span>Previous</span>
        </Button>
    );
};

const NextButton = ({
    activeIndex,
    setActiveIndex,
    stepsLength,
    isStepIncomplete,
}: {
    activeIndex: number;
    setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
    stepsLength: number;
    isStepIncomplete: boolean;
}) => {
    const isSubmit = activeIndex === stepsLength - 2;
    const disabled = activeIndex === stepsLength - 1 || isStepIncomplete;

    return (
        <Button
            variant={isSubmit ? 'success' : 'neutral'}
            className="w-full sm:w-48 ml-auto justify-between"
            disabled={disabled}
            onClick={() => setActiveIndex(prev => prev + 1)}
        >
            <span>{isSubmit ? 'Submit' : 'Next'}</span>
            <HiArrowRight />
        </Button>
    );
};

// Index 4 is the submission stage, which submits on mount: neither a prefill nor a saved index may land on it
const MAX_RESTORED_INDEX = 3;
const clampRestoredIndex = (index: number): number => Math.min(Math.max(Math.trunc(index) || 0, 0), MAX_RESTORED_INDEX);

/** Wizard state pushed in from outside the wizard (Rucio bot prefill). A new object applies it again. */
export interface CreateRulePrefill {
    parameters: CreateRuleParameters;
    activeIndex: number;
    nonce: number;
}

interface CreateRuleProps {
    getSavedParameters: () => CreateRuleParameters | undefined;
    getSavedIndex: () => number | undefined;
    setSavedParameters: (parameters: CreateRuleParameters) => void;
    setSavedIndex: (activeIndex: number) => void;
    removeSavedParameters: () => void;
    removeSavedIndex: () => void;
    prefill?: CreateRulePrefill;
    /** Called with the active stage index whenever it changes, including the submission stage (4). */
    onStageChange?: (activeIndex: number) => void;
}

export const CreateRule = (props: CreateRuleProps) => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [parameters, setParameters] = useState<CreateRuleParameters>(getEmptyCreateRuleParameters());
    const [activeIndex, setActiveIndex] = useState<number>(0);
    const [optionsErrors, setOptionsErrors] = useState<CreateRuleOptionsErrors>(getEmptyOptionsErrors());
    // Bumped on every prefill so the stages remount: some of them copy parameters into local state on mount
    const [stageKey, setStageKey] = useState<number>(0);

    const checkOptionsErrors = () => {
        setOptionsErrors(computeOptionsErrors(parameters));
    };

    useEffect(() => {
        const savedParameters = props.getSavedParameters();
        if (savedParameters) setParameters(savedParameters);

        const savedIndex = props.getSavedIndex();
        if (savedIndex) setActiveIndex(clampRestoredIndex(savedIndex));

        setIsLoading(false);
    }, []);

    const prefill = props.prefill;
    useEffect(() => {
        if (isLoading || !prefill) return;
        const index = clampRestoredIndex(prefill.activeIndex);
        setParameters(prefill.parameters);
        setActiveIndex(index);
        setStageKey(previous => previous + 1);
    }, [prefill, isLoading]);

    // Effects to sync parameters and activeIndex with localStorage
    useEffect(() => {
        if (isLoading) return;
        props.setSavedParameters(parameters);
        checkOptionsErrors();
    }, [parameters]);
    useEffect(() => {
        if (isLoading) return;
        props.onStageChange?.(activeIndex);
    }, [activeIndex, isLoading]);
    useEffect(() => {
        // Don't save submission
        if (isLoading || activeIndex === 4) return;
        props.setSavedIndex(activeIndex);
    }, [activeIndex]);

    // Utility to partially update parameters
    const updateParameters = (newParams: Partial<CreateRuleParameters>) => {
        setParameters(prevState => ({ ...prevState, ...newParams }));
    };

    const updateStorage = (storage: CreateRuleStorage) => updateParameters(storage);
    const updateNeedsApproval = (needsApproval: boolean) => updateParameters({ needsApproval });
    const updateAskApproval = (askApproval: boolean) => updateParameters({ askApproval });
    const updateOptionValue = (key: keyof CreateRuleOptions, value: any) => {
        setParameters(prevState => ({
            ...prevState,
            [key]: value,
        }));
    };

    const addDID = (did: ListDIDsViewModel) => {
        setParameters(prevState => {
            const didExists = prevState.dids.some(element => element.scope === did.scope && element.name === did.name);
            if (didExists) return prevState;

            return { ...prevState, dids: [...prevState.dids, did] };
        });
    };

    const removeDID = (did: ListDIDsViewModel) => {
        setParameters(prevState => ({
            ...prevState,
            dids: prevState.dids.filter(element => element.scope !== did.scope || element.name !== did.name),
        }));
    };

    const isStepIncomplete = (): boolean => {
        let isIncomplete = false;

        if (activeIndex >= 0) {
            isIncomplete = isIncomplete || parameters.dids.length === 0;
        }
        if (activeIndex >= 1) {
            isIncomplete = isIncomplete || parameters.rses.length === 0 || (parameters.needsApproval && !parameters.askApproval);
        }
        if (activeIndex >= 2) {
            isIncomplete = isIncomplete || Object.values(optionsErrors).some(error => error);
        }

        return isIncomplete;
    };

    const steps = ['DIDs', 'RSEs', 'Options', 'Summary', 'Results'];

    if (isLoading) {
        return (
            <main className="min-h-screen bg-neutral-0 dark:bg-neutral-900 transition-colors duration-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
                    <div className="flex w-full items-center justify-center min-h-[400px]">
                        <LoadingSpinner />
                    </div>
                </div>
            </main>
        );
    }

    const getPaginationPanel = () => {
        return (
            <div className="flex flex-col sm:flex-row sm:justify-between space-y-2 sm:space-y-0">
                <PreviousButton activeIndex={activeIndex} setActiveIndex={setActiveIndex} />
                <NextButton
                    activeIndex={activeIndex}
                    setActiveIndex={setActiveIndex}
                    stepsLength={steps.length}
                    isStepIncomplete={isStepIncomplete()}
                />
            </div>
        );
    };

    // Keep stage DIDs rendered, as it may contain large streamed data
    return (
        <main className="min-h-screen bg-neutral-0 dark:bg-neutral-900 transition-colors duration-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
                <div className="flex flex-col space-y-6 w-full">
                    <header className="mb-2">
                        <Heading text="New Rule" />
                    </header>
                    <Timeline steps={steps} activeIndex={activeIndex} onSwitch={activeIndex !== 4 ? setActiveIndex : undefined} />
                    <div>
                        <CreateRuleStageData
                            key={`dids-${stageKey}`}
                            visible={activeIndex === 0}
                            parameters={parameters}
                            addDID={addDID}
                            removeDID={removeDID}
                        />
                        {activeIndex === 1 && (
                            <CreateRuleStageStorage
                                key={`rses-${stageKey}`}
                                parameters={parameters}
                                updateStorage={updateStorage}
                                updateNeedsApproval={updateNeedsApproval}
                                updateAskApproval={updateAskApproval}
                            />
                        )}
                        {activeIndex === 2 && (
                            <CreateRuleStageOptions
                                key={`options-${stageKey}`}
                                parameters={parameters}
                                updateOptionValue={updateOptionValue}
                                errors={optionsErrors}
                            />
                        )}
                        {activeIndex === 3 && <CreateRuleStageSummary key={`summary-${stageKey}`} parameters={parameters} />}
                    </div>
                    {activeIndex === 4 && (
                        <CreateRuleStageSubmission
                            parameters={parameters}
                            removeSaved={() => {
                                props.removeSavedIndex();
                                props.removeSavedParameters();
                            }}
                        />
                    )}
                    {activeIndex !== 4 && getPaginationPanel()}
                </div>
            </div>
        </main>
    );
};
