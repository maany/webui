'use client';

import * as React from 'react';
import { HiOutlineShieldExclamation } from 'react-icons/hi';
import { Button } from '@/component-library/atoms/form/button';
import { Checkbox } from '@/component-library/atoms/form/checkbox';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/component-library/atoms/misc/Collapsible';
import { JSONViewer } from '@/component-library/features/json';
import { cn } from '@/component-library/utils';
import type { ToolRisk } from '@/lib/core/entity/assistant/tool';
import { maskSensitiveArgs } from '@/lib/infrastructure/assistant/approvals';

export type ApprovalCardDecision = 'approved' | 'rejected' | 'expired';

export interface ApprovalCardProps {
    toolName: string;
    summary: string;
    risk: ToolRisk;
    /** The arguments to show. For an invalid-args call these are the arguments the model sent. */
    args: unknown;
    policyReason?: string;
    /** Show "Allow for this conversation". The caller passes false for high-risk tools and when the operator cap is below allow. */
    allowConversationScope: boolean;
    sensitiveArgs?: readonly string[];
    /** Set when the model sent arguments that failed validation: the card explains why and only offers Reject. */
    invalidArgsMessage?: string;
    /** Set for a decided or expired call: the card is read-only. */
    decision?: ApprovalCardDecision;
    onResolve?: (decision: 'approved' | 'rejected', scope: 'once' | 'conversation') => void;
    className?: string;
}

const DECISION_COPY: Record<ApprovalCardDecision, { label: string; note: string; variant: 'success' | 'error' | 'neutral' }> = {
    approved: { label: 'Approved', note: 'You approved this action.', variant: 'success' },
    rejected: { label: 'Rejected', note: 'You rejected this action. It did not run.', variant: 'error' },
    expired: { label: 'Expired', note: 'Nobody approved this action before the chat was closed. It did not run.', variant: 'neutral' },
};

/**
 * In-chat approval for a tool call the policy gate set to "ask". Never collapsed: only the raw
 * arguments fold away. Approve comes first and the card scrolls into view, so on mobile it is
 * never below the fold.
 */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({
    toolName,
    summary,
    risk,
    args,
    policyReason,
    allowConversationScope,
    sensitiveArgs,
    invalidArgsMessage,
    decision,
    onResolve,
    className,
}) => {
    const titleId = React.useId();
    const scopeId = React.useId();
    const rootRef = React.useRef<HTMLElement>(null);
    const [allowConversation, setAllowConversation] = React.useState(false);
    const [submitted, setSubmitted] = React.useState(false);
    const pending = decision === undefined;
    const highRisk = risk === 'high';
    const invalid = invalidArgsMessage !== undefined;

    React.useEffect(() => {
        if (pending) rootRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [pending]);

    const argsJson = React.useMemo(() => JSON.stringify(maskSensitiveArgs(args, sensitiveArgs ?? []), null, 2) ?? 'null', [args, sensitiveArgs]);

    const resolve = (choice: 'approved' | 'rejected') => {
        if (submitted || !onResolve) return;
        setSubmitted(true);
        onResolve(choice, choice === 'approved' && allowConversationScope && allowConversation ? 'conversation' : 'once');
    };

    const title = invalid
        ? pending
            ? 'Rucio bot sent invalid arguments'
            : 'Invalid arguments'
        : pending
        ? highRisk
            ? 'High-risk action needs approval'
            : 'Action needs approval'
        : highRisk
        ? 'High-risk action'
        : 'Action';

    return (
        <section
            ref={rootRef}
            aria-labelledby={titleId}
            data-testid="approval-card"
            className={cn(
                'w-full rounded-lg border p-4 space-y-3',
                highRisk ? 'border-base-error-600 dark:border-base-error-500' : 'border-base-warning-600 dark:border-base-warning-500',
                pending ? 'bg-neutral-0 dark:bg-neutral-900' : 'bg-neutral-100 dark:bg-neutral-800',
                className,
            )}
        >
            <div className="flex items-start gap-2">
                <HiOutlineShieldExclamation
                    aria-hidden="true"
                    className={cn('mt-0.5 h-5 w-5 shrink-0', highRisk ? 'text-base-error-600' : 'text-base-warning-600')}
                />
                <div className="min-w-0 flex-1">
                    <h3 id={titleId} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {title}
                    </h3>
                    <p className="font-mono text-xs text-neutral-600 dark:text-neutral-400 break-all">{toolName}</p>
                </div>
                {decision && (
                    <Badge size="sm" variant={DECISION_COPY[decision].variant}>
                        {DECISION_COPY[decision].label}
                    </Badge>
                )}
            </div>

            <p className="text-base font-medium text-neutral-900 dark:text-neutral-100 break-words">{summary}</p>
            {invalid && <p className="text-sm text-neutral-700 dark:text-neutral-300 break-words">{invalidArgsMessage}</p>}
            {policyReason && !invalid && <p className="text-sm text-neutral-600 dark:text-neutral-400">{policyReason}</p>}

            {decision ? (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">{DECISION_COPY[decision].note}</p>
            ) : (
                <>
                    {allowConversationScope && !invalid && (
                        <div className="flex min-h-11 items-center gap-3">
                            <Checkbox
                                id={scopeId}
                                checked={allowConversation}
                                disabled={submitted}
                                onCheckedChange={value => setAllowConversation(value === true)}
                            />
                            <label htmlFor={scopeId} className="text-sm text-neutral-900 dark:text-neutral-100">
                                Allow for this conversation
                            </label>
                        </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
                        {!invalid && (
                            <Button
                                variant={highRisk ? 'error' : 'default'}
                                className="min-h-11 w-full sm:w-auto"
                                disabled={submitted}
                                onClick={() => resolve('approved')}
                            >
                                Approve
                            </Button>
                        )}
                        <Button variant="neutral" className="min-h-11 w-full sm:w-auto" disabled={submitted} onClick={() => resolve('rejected')}>
                            Reject
                        </Button>
                    </div>
                </>
            )}

            <Collapsible>
                <CollapsibleTrigger variant="ghost" size="sm" className="min-h-11 px-2">
                    Show arguments
                </CollapsibleTrigger>
                <CollapsibleContent variant="ghost">
                    <JSONViewer value={argsJson} mode="static" showRawToggle={false} maxHeight="240px" />
                </CollapsibleContent>
            </Collapsible>
        </section>
    );
};

ApprovalCard.displayName = 'ApprovalCard';
