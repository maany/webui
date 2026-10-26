'use client';
import { CreateRule, CreateRulePrefill } from '@/component-library/pages/Rule/create/CreateRule';
import { CreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { useEffect, useRef, useState } from 'react';
import { toolError } from '@/lib/infrastructure/assistant/page-tool-errors';
import { usePageAction } from '@/lib/infrastructure/hooks/usePageAction';
import {
    RULE_CREATE_PREFILL_ACTION,
    RULE_CREATE_PREFILL_DESCRIPTION,
    RuleCreatePrefillSchema,
    resolveRuleCreatePrefill,
} from '@/lib/infrastructure/assistant/page-actions/rule-create-prefill';

const PARAMS_KEY = 'create_rule_parameters';
const ACTIVE_KEY = 'create_rule_active';

export default function Page() {
    useEffect(() => {
        document.title = 'Create Rule - Rucio';
    }, []);

    // Rucio bot fills the wizard through this state; the user still reviews and submits.
    const [prefill, setPrefill] = useState<CreateRulePrefill | undefined>(undefined);
    const prefillCount = useRef(0);
    // Index 4 is the submission stage, which submits a rule on mount
    const SUBMISSION_STAGE = 4;
    const stageIndex = useRef(0);

    usePageAction({
        name: RULE_CREATE_PREFILL_ACTION,
        description: RULE_CREATE_PREFILL_DESCRIPTION,
        schema: RuleCreatePrefillSchema,
        apply: async args => {
            if (stageIndex.current === SUBMISSION_STAGE) {
                throw toolError('unavailable', 'The wizard is submitting a rule. Wait for it to finish, then try again.');
            }
            const id = ++prefillCount.current;
            const result = await resolveRuleCreatePrefill(args);
            if (id !== prefillCount.current) throw toolError('aborted', 'A newer prefill replaced this one.');
            if (stageIndex.current === SUBMISSION_STAGE) {
                throw toolError('unavailable', 'The wizard is submitting a rule. Wait for it to finish, then try again.');
            }
            setPrefill({ parameters: result.parameters, activeIndex: result.activeIndex, nonce: id });
            return result.summary;
        },
    });

    const getSavedParameters = () => {
        const initialParametersString = localStorage.getItem(PARAMS_KEY);
        // TODO: check with zod
        if (initialParametersString) {
            try {
                return JSON.parse(initialParametersString);
            } catch (e) {
                return undefined;
            }
        }
        return undefined;
    };

    const getSavedIndex = () => {
        const initialActiveString = localStorage.getItem(ACTIVE_KEY);

        if (initialActiveString) {
            const numberValue = parseInt(initialActiveString);
            return isNaN(numberValue) ? undefined : numberValue;
        }
    };

    const setSavedParameters = (parameters: CreateRuleParameters) => {
        localStorage.setItem(PARAMS_KEY, JSON.stringify(parameters));
    };

    const setSavedIndex = (activeIndex: number) => {
        localStorage.setItem(ACTIVE_KEY, activeIndex.toString());
    };

    const removeSavedParameters = () => {
        localStorage.removeItem(PARAMS_KEY);
    };

    const removeSavedIndex = () => {
        localStorage.removeItem(ACTIVE_KEY);
    };

    return (
        <CreateRule
            getSavedIndex={getSavedIndex}
            getSavedParameters={getSavedParameters}
            setSavedIndex={setSavedIndex}
            setSavedParameters={setSavedParameters}
            removeSavedParameters={removeSavedParameters}
            removeSavedIndex={removeSavedIndex}
            prefill={prefill}
            onStageChange={index => {
                stageIndex.current = index;
            }}
        />
    );
}
