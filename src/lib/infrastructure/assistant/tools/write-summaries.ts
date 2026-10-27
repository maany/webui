import { formatFileSize } from '@/component-library/features/utils/text-formatters';
import type { AddAccountAttributeInput } from '@/lib/infrastructure/api-schemas/add-account-attribute';
import type { AddAccountIdentityInput } from '@/lib/infrastructure/api-schemas/add-account-identity';
import type { AddDidInput } from '@/lib/infrastructure/api-schemas/add-did';
import type { AttachDidsInput } from '@/lib/infrastructure/api-schemas/attach-dids';
import type { CreateAccountInput } from '@/lib/infrastructure/api-schemas/create-account';
import type { CreateRuleInput } from '@/lib/infrastructure/api-schemas/create-rule';
import type { DeclareBadReplicasInput } from '@/lib/infrastructure/api-schemas/declare-bad-replicas';
import type { DeleteAccountInput } from '@/lib/infrastructure/api-schemas/delete-account';
import type { DeleteAccountAttributeInput } from '@/lib/infrastructure/api-schemas/delete-account-attribute';
import type { DeleteAccountIdentityInput } from '@/lib/infrastructure/api-schemas/delete-account-identity';
import type { DeleteAccountLimitInput } from '@/lib/infrastructure/api-schemas/delete-account-limit';
import type { SetAccountLimitInput } from '@/lib/infrastructure/api-schemas/set-account-limit';
import type { SetDidStatusInput } from '@/lib/infrastructure/api-schemas/set-did-status';
import type { UpdateAccountInput } from '@/lib/infrastructure/api-schemas/update-account';
import type { UpdateAccountAttributeInput } from '@/lib/infrastructure/api-schemas/update-account-attribute';
import type { UpdateRuleInput } from '@/lib/infrastructure/api-schemas/update-rule';

const MAX_TEXT = 80;

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** One line, at most `max` characters. User text (reasons, comments) goes through this. */
export function truncate(text: string, max = MAX_TEXT): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}

export function formatDid(did: { scope: string; name: string }): string {
    return truncate(`${did.scope}:${did.name}`);
}

export function formatDidList(dids: ReadonlyArray<{ scope: string; name: string }>, max = 2): string {
    const names = dids.map(formatDid);
    if (names.length <= 1) return names[0] ?? 'no DIDs';
    if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

export function formatLifetimeSeconds(seconds: number): string {
    if (seconds > 0 && seconds % 86400 === 0) return plural(seconds / 86400, 'day');
    if (seconds > 0 && seconds % 3600 === 0) return plural(seconds / 3600, 'hour');
    if (seconds > 0 && seconds % 60 === 0) return plural(seconds / 60, 'minute');
    return plural(seconds, 'second');
}

export function summarizeCreateRule(args: CreateRuleInput): string {
    const lifetime = args.lifetime_days !== undefined ? `lifetime ${plural(args.lifetime_days, 'day')}` : 'no lifetime';
    const extras = [
        args.grouping ? `grouping ${args.grouping}` : '',
        args.ask_approval ? 'asks for approval' : '',
        args.sample ? (args.sample_file_count ? `sample of ${plural(args.sample_file_count, 'file')}` : 'sample') : '',
        args.asynchronous ? 'asynchronous' : '',
        args.notify ? 'with notifications' : '',
        args.comments ? `comment "${truncate(args.comments, 60)}"` : '',
    ].filter(Boolean);
    const tail = extras.length > 0 ? `, ${extras.join(', ')}` : '';
    return `Create rule: ${plural(args.copies, 'copy', 'copies')} of ${formatDidList(args.dids)} on ${truncate(
        args.rse_expression,
    )}, ${lifetime}${tail}`;
}

export function summarizeUpdateRule(args: UpdateRuleInput): string {
    const { options } = args;
    const parts: string[] = [];
    if (options.approve === true) parts.push('approve');
    if (options.approve === false) parts.push('deny');
    if (options.lifetime !== undefined)
        parts.push(options.lifetime === null ? 'remove the lifetime' : `lifetime ${formatLifetimeSeconds(options.lifetime)}`);
    if (options.priority !== undefined) parts.push(`priority ${options.priority}`);
    if (options.comment !== undefined) parts.push(`comment "${truncate(options.comment, 60)}"`);
    return `Update rule ${truncate(args.ruleId, 40)}: ${parts.join(', ')}`;
}

export function summarizeAddDid(args: AddDidInput): string {
    return `Create ${args.type.toLowerCase()} ${formatDid(args)}`;
}

export function summarizeAttachDids(args: AttachDidsInput): string {
    return `Attach ${plural(args.dids.length, 'DID')} to ${formatDid(args)}: ${formatDidList(args.dids)}`;
}

export function summarizeSetDidStatus(args: SetDidStatusInput): string {
    return `${args.open ? 'Open' : 'Close'} ${formatDid(args)}`;
}

export function summarizeDeclareBadReplicas(args: DeclareBadReplicasInput): string {
    const expiry = args.expiresAt ? `. Expires ${truncate(args.expiresAt, 30)}` : '';
    return `Declare ${plural(args.dids.length, 'replica')} bad on ${truncate(args.rse, 40)}: ${formatDidList(args.dids)}. Reason: ${truncate(
        args.reason,
    )}${expiry}`;
}

export function summarizeCreateAccount(args: CreateAccountInput): string {
    const email = args.email ? `with email ${args.email}` : 'without email';
    return `Create ${String(args.accountType).toLowerCase()} account ${args.account} ${email}`;
}

export function summarizeUpdateAccount(args: UpdateAccountInput): string {
    const { options } = args;
    const parts: string[] = [];
    if (options.status === 'ACTIVE') parts.push('reactivate');
    if (options.status === 'SUSPENDED') parts.push('suspend');
    if (options.email !== undefined) parts.push(options.email === null ? 'clear email' : `email ${options.email}`);
    if (options.accountType !== undefined) parts.push(`type ${options.accountType}`);
    return `Update account ${args.account}: ${parts.join(', ')}`;
}

export function summarizeDeleteAccount(args: DeleteAccountInput): string {
    return `Delete account ${args.account}`;
}

export function summarizeAddAccountAttribute(args: AddAccountAttributeInput): string {
    return `Add attribute ${args.key}=${args.value} to account ${args.account}`;
}

export function summarizeUpdateAccountAttribute(args: UpdateAccountAttributeInput): string {
    return `Set attribute ${args.key}=${args.value} on account ${args.account}`;
}

export function summarizeDeleteAccountAttribute(args: DeleteAccountAttributeInput): string {
    return `Delete attribute ${args.key} from account ${args.account}`;
}

/** Never includes the password, only whether one is set. */
export function summarizeAddAccountIdentity(args: AddAccountIdentityInput): string {
    const asDefault = args.isDefault ? ' as default' : '';
    const password = args.password ? ', with a password' : '';
    return `Add ${args.authType} identity ${truncate(args.identity)} to account ${args.account}${asDefault}${password}`;
}

export function summarizeDeleteAccountIdentity(args: DeleteAccountIdentityInput): string {
    return `Remove ${args.authType} identity ${truncate(args.identity)} from account ${args.account}`;
}

export function summarizeSetAccountLimit(args: SetAccountLimitInput): string {
    const size = args.bytes === -1 ? 'unlimited' : formatFileSize(args.bytes);
    return `Set ${args.locality} quota of account ${args.account} on ${truncate(args.rseExpression)} to ${size}`;
}

export function summarizeDeleteAccountLimit(args: DeleteAccountLimitInput): string {
    return `Remove ${args.locality} quota of account ${args.account} on ${truncate(args.rseExpression)}`;
}
