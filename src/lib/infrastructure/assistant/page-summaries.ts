import type { RSEAttribute } from '@/lib/core/entity/rucio';
import type { DIDMetaViewModel } from '@/lib/infrastructure/data/view-model/did';
import type { RuleMetaViewModel } from '@/lib/infrastructure/data/view-model/rule';
import type { RSEDetailsViewModel } from '@/lib/infrastructure/data/view-model/rse';
import type { AccountInfoViewModel } from '@/lib/infrastructure/data/view-model/account';
import type { SubscriptionViewModel } from '@/lib/infrastructure/data/view-model/subscriptions';
import type { AccountQuotas, AccountTab } from '@/component-library/pages/Account/details/details-account-types';
import { clampSummary } from '@/lib/infrastructure/assistant/page-summary-text';

const NEAR_LIMIT = 0.9;
const RSE_ATTRIBUTES_SHOWN = 10;

const yesNo = (value: boolean | null | undefined): string => (value ? 'yes' : 'no');
const loading = (what: string): string => clampSummary(`${what}, details are loading or failed to load.`);

export function describeDIDPage(input: { scope: string; name: string; meta?: DIDMetaViewModel | null }): string {
    const { meta } = input;
    if (!meta) return loading(`DID ${input.scope}:${input.name}`);
    const parts = [`${meta.did_type} ${meta.scope}:${meta.name}`, `owner ${meta.account}`, `availability ${meta.availability}`];
    if (meta.bytes !== null) parts.push(`${meta.bytes} bytes`);
    if (meta.is_open !== null) parts.push(meta.is_open ? 'open' : 'closed');
    if (meta.obsolete) parts.push('obsolete');
    parts.push(`created ${meta.created_at}`);
    return clampSummary(`${parts.join(', ')}.`);
}

export function describeRulePage(input: { id: string; meta?: RuleMetaViewModel | null }): string {
    const { meta } = input;
    if (!meta) return loading(`Rule ${input.id}`);
    return clampSummary(
        `Rule ${input.id}, state ${meta.state}, DID ${meta.scope}:${meta.name}, account ${meta.account}, ` +
            `RSE expression ${meta.rse_expression}, ${meta.copies} ${meta.copies === 1 ? 'copy' : 'copies'}, ` +
            `locks OK ${meta.locks_ok_cnt}, replicating ${meta.locks_replicating_cnt}, stuck ${meta.locks_stuck_cnt}, ` +
            `activity ${meta.activity}, expires ${meta.expires_at ?? 'never'}.`,
    );
}

export function describeRSEPage(input: { name: string; meta?: RSEDetailsViewModel | null; attributes?: RSEAttribute[] }): string {
    const { meta } = input;
    if (!meta) return loading(`RSE ${input.name}`);
    let summary =
        `RSE ${input.name}, ${meta.rse_type}, deterministic ${yesNo(meta.deterministic)}, volatile ${yesNo(meta.volatile)}, ` +
        `read ${yesNo(meta.availability_read)}, write ${yesNo(meta.availability_write)}, delete ${yesNo(meta.availability_delete)}, ` +
        `${meta.protocols.length} protocols.`;
    if (input.attributes && input.attributes.length > 0) {
        const shown = input.attributes.slice(0, RSE_ATTRIBUTES_SHOWN).map(attribute => `${attribute.key}=${String(attribute.value)}`);
        summary += ` Attributes: ${shown.join(', ')}.`;
    }
    return clampSummary(summary);
}

function nearLimit(quota: { bytesLimit: number | null; bytesUsed: number }): boolean {
    return quota.bytesLimit !== null && quota.bytesLimit > 0 && quota.bytesUsed / quota.bytesLimit >= NEAR_LIMIT;
}

export function describeAccountPage(input: { account: string; info?: AccountInfoViewModel; tab: AccountTab; quotas?: AccountQuotas }): string {
    const { info, quotas } = input;
    if (!info) return loading(`Account ${input.account}`);
    let summary = `Account ${input.account}, ${info.accountType}, status ${info.accountStatus}, tab ${input.tab}.`;
    if (quotas) {
        const near = [...quotas.local, ...quotas.global].filter(nearLimit).length;
        summary += ` ${quotas.local.length} local and ${quotas.global.length} global quotas, ${near} at 90% or more of the limit.`;
    } else {
        summary += ' Quotas not loaded.';
    }
    return clampSummary(summary);
}

export function describeSubscriptionPage(input: { account: string; name: string; meta?: SubscriptionViewModel | null }): string {
    const { meta } = input;
    if (!meta) return loading(`Subscription ${input.account}:${input.name}`);
    return clampSummary(
        `Subscription ${meta.account}:${meta.name}, state ${meta.state}, retroactive ${yesNo(meta.retroactive)}, policy ${meta.policyid}, ` +
            `last processed ${meta.last_processed}, lifetime ${meta.lifetime}. Filter: ${meta.filter}`,
    );
}
