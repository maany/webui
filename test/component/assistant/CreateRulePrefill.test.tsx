import React from 'react';
import { render, screen } from '@testing-library/react';
import { CreateRule, CreateRulePrefill } from '@/component-library/pages/Rule/create/CreateRule';
import { CreateRuleParameters, getEmptyCreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { DIDType } from '@/lib/core/entity/rucio';

const mockStageMounts = jest.fn();
const mockSubmissionMounts = jest.fn();

jest.mock('@/component-library/pages/Rule/create/stage-dids/CreateRuleStageData', () => {
    const React = require('react');
    return {
        CreateRuleStageData: (props: { visible: boolean; parameters: { dids: { scope: string; name: string }[] } }) => {
            React.useEffect(() => {
                mockStageMounts('dids');
            }, []);
            return <div data-testid="stage-dids">{props.visible ? props.parameters.dids.map(d => `${d.scope}:${d.name}`).join(',') : ''}</div>;
        },
    };
});
jest.mock('@/component-library/pages/Rule/create/stage-rses/CreateRuleStageStorage', () => ({
    CreateRuleStageStorage: (props: { parameters: { rses: { rse: string }[] } }) => (
        <div data-testid="stage-rses">{props.parameters.rses.map(r => r.rse).join(',')}</div>
    ),
}));
jest.mock('@/component-library/pages/Rule/create/stage-options/CreateRuleStageOptions', () => ({
    CreateRuleStageOptions: () => <div data-testid="stage-options" />,
}));
jest.mock('@/component-library/pages/Rule/create/stage-summary/CreateRuleStageSummary', () => ({
    CreateRuleStageSummary: (props: { parameters: { dids: { scope: string; name: string }[]; rses: { rse: string }[]; copies: number } }) => (
        <div data-testid="stage-summary">
            {props.parameters.dids.map(d => `${d.scope}:${d.name}`).join(',')}|{props.parameters.rses.map(r => r.rse).join(',')}|copies=
            {props.parameters.copies}
        </div>
    ),
}));
jest.mock('@/component-library/pages/Rule/create/stage-submission/CreateRuleStageSubmission', () => ({
    CreateRuleStageSubmission: () => {
        const React = require('react');
        React.useEffect(() => {
            mockSubmissionMounts();
        }, []);
        return <div data-testid="stage-submission" />;
    },
}));

const prefilled: CreateRuleParameters = {
    ...getEmptyCreateRuleParameters(),
    dids: [{ status: 'success', scope: 'user.jdoe', name: 'file1', did_type: DIDType.FILE, bytes: 1000, length: 1, open: false }],
    rses: [
        {
            status: 'success',
            rse: 'CERN-PROD',
            rse_id: '1',
            account: 'jdoe',
            files: 0,
            used_bytes: 0,
            bytes_limit: 10_000,
            bytes_remaining: 10_000,
            has_quota: true,
            total_expected_usage: 1000,
        },
    ],
    rseExpression: 'tier=1',
    copies: 1,
};

const makeProps = () => ({
    getSavedParameters: jest.fn(() => undefined),
    getSavedIndex: jest.fn(() => undefined),
    setSavedParameters: jest.fn(),
    setSavedIndex: jest.fn(),
    removeSavedParameters: jest.fn(),
    removeSavedIndex: jest.fn(),
});

describe('CreateRule prefill', () => {
    beforeEach(() => {
        mockStageMounts.mockClear();
        mockSubmissionMounts.mockClear();
    });

    it('applies a prefill to the mounted wizard, saves it and jumps to the given step', async () => {
        const props = makeProps();
        const { rerender } = render(<CreateRule {...props} />);
        expect(await screen.findByTestId('stage-dids')).toBeInTheDocument();

        const prefill: CreateRulePrefill = { parameters: prefilled, activeIndex: 3, nonce: 1 };
        rerender(<CreateRule {...props} prefill={prefill} />);

        expect(await screen.findByTestId('stage-summary')).toHaveTextContent('user.jdoe:file1|CERN-PROD|copies=1');
        expect(props.setSavedParameters).toHaveBeenLastCalledWith(prefilled);
        expect(props.setSavedIndex).toHaveBeenLastCalledWith(3);
    });

    it('remounts the stages so their local state starts from the prefill', async () => {
        const props = makeProps();
        const { rerender } = render(<CreateRule {...props} />);
        await screen.findByTestId('stage-dids');
        expect(mockStageMounts).toHaveBeenCalledTimes(1);

        rerender(<CreateRule {...props} prefill={{ parameters: prefilled, activeIndex: 0, nonce: 1 }} />);
        expect(await screen.findByTestId('stage-dids')).toHaveTextContent('user.jdoe:file1');
        expect(mockStageMounts).toHaveBeenCalledTimes(2);
    });

    it('overrides saved parameters when a prefill arrives', async () => {
        const props = makeProps();
        props.getSavedParameters.mockReturnValue({ ...getEmptyCreateRuleParameters(), copies: 4 } as never);
        props.getSavedIndex.mockReturnValue(2 as never);
        const { rerender } = render(<CreateRule {...props} />);
        await screen.findByTestId('stage-options');

        rerender(<CreateRule {...props} prefill={{ parameters: prefilled, activeIndex: 1, nonce: 1 }} />);
        expect(await screen.findByTestId('stage-rses')).toHaveTextContent('CERN-PROD');
    });

    it('clamps an out-of-range activeIndex so the submission stage never opens', async () => {
        const props = makeProps();
        const { rerender } = render(<CreateRule {...props} />);
        await screen.findByTestId('stage-dids');

        rerender(<CreateRule {...props} prefill={{ parameters: prefilled, activeIndex: 4, nonce: 1 }} />);
        expect(await screen.findByTestId('stage-summary')).toBeInTheDocument();
        expect(screen.queryByTestId('stage-submission')).not.toBeInTheDocument();
        expect(props.setSavedIndex).toHaveBeenLastCalledWith(3);
        expect(mockSubmissionMounts).not.toHaveBeenCalled();
    });

    it('clamps negative and NaN indices to the first stage', async () => {
        const props = makeProps();
        const { rerender } = render(<CreateRule {...props} />);
        await screen.findByTestId('stage-dids');

        rerender(<CreateRule {...props} prefill={{ parameters: prefilled, activeIndex: Number.NaN, nonce: 1 }} />);
        expect(await screen.findByTestId('stage-dids')).toHaveTextContent('user.jdoe:file1');
        expect(screen.queryByTestId('stage-submission')).not.toBeInTheDocument();
    });

    it('lands on the first stage for a negative activeIndex, even from a saved later stage', async () => {
        const props = makeProps();
        props.getSavedIndex.mockReturnValue(2 as never);
        const { rerender } = render(<CreateRule {...props} />);
        await screen.findByTestId('stage-options');

        rerender(<CreateRule {...props} prefill={{ parameters: prefilled, activeIndex: -2, nonce: 1 }} />);
        expect(await screen.findByTestId('stage-dids')).toHaveTextContent('user.jdoe:file1');
        expect(screen.queryByTestId('stage-options')).not.toBeInTheDocument();
        expect(props.setSavedIndex).toHaveBeenLastCalledWith(0);
    });

    it('clamps a tampered saved index so the submission stage cannot open on load', async () => {
        const props = makeProps();
        props.getSavedIndex.mockReturnValue(4 as never);
        render(<CreateRule {...props} />);
        expect(await screen.findByTestId('stage-summary')).toBeInTheDocument();
        expect(mockSubmissionMounts).not.toHaveBeenCalled();
        expect(screen.queryByTestId('stage-submission')).not.toBeInTheDocument();
    });

    it('reports every stage change, including the submission stage', async () => {
        const props = makeProps();
        const onStageChange = jest.fn();
        props.getSavedIndex.mockReturnValue(3 as never);
        props.getSavedParameters.mockReturnValue(prefilled as never);
        render(<CreateRule {...props} onStageChange={onStageChange} />);
        await screen.findByTestId('stage-summary');
        expect(onStageChange).toHaveBeenLastCalledWith(3);

        screen.getByRole('button', { name: /submit/i }).click();
        expect(await screen.findByTestId('stage-submission')).toBeInTheDocument();
        expect(onStageChange).toHaveBeenLastCalledWith(4);
    });
});
