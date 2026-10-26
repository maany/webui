import type { z } from 'zod';
import { AddAccountAttributeSchema } from './add-account-attribute';
import { AddAccountIdentitySchema } from './add-account-identity';
import { AddDidSchema } from './add-did';
import { AttachDidsSchema } from './attach-dids';
import { CreateAccountSchema } from './create-account';
import { CreateRuleSchema } from './create-rule';
import { DeclareBadReplicasSchema } from './declare-bad-replicas';
import { DeleteAccountSchema } from './delete-account';
import { DeleteAccountAttributeSchema } from './delete-account-attribute';
import { DeleteAccountIdentitySchema } from './delete-account-identity';
import { DeleteAccountLimitSchema } from './delete-account-limit';
import { GetAccountInfoSchema } from './get-account-info';
import { GetAccountQuotasSchema } from './get-account-quotas';
import { GetAmiTagInfoSchema } from './get-ami-tag-info';
import { GetAssistantConfigSchema } from './get-assistant-config';
import { GetDdmLinkSchema } from './get-ddm-link';
import { GetDidKeyvaluepairsSchema } from './get-did-keyvaluepairs';
import { GetDidMetaSchema } from './get-did-meta';
import { GetFtsLinkSchema } from './get-fts-link';
import { GetPandaTaskLinkSchema } from './get-panda-task-link';
import { GetRseSchema } from './get-rse';
import { GetRseAttributesSchema } from './get-rse-attributes';
import { GetRseProtocolsSchema } from './get-rse-protocols';
import { GetRseUsageSchema } from './get-rse-usage';
import { GetRuleSchema } from './get-rule';
import { GetSiteHeaderSchema } from './get-site-header';
import { GetSubscriptionSchema } from './get-subscription';
import { ListAccountAttributesSchema } from './list-account-attributes';
import { ListAccountIdentitiesSchema } from './list-account-identities';
import { ListAccountRseQuotasSchema } from './list-account-rse-quotas';
import { ListAccountRseUsageSchema } from './list-account-rse-usage';
import { ListAccountsSchema } from './list-accounts';
import { ListAllRsesSchema } from './list-all-rses';
import { ListDatasetReplicasSchema } from './list-dataset-replicas';
import { ListDidContentsSchema } from './list-did-contents';
import { ListDidParentsSchema } from './list-did-parents';
import { ListDidRulesSchema } from './list-did-rules';
import { ListDidsSchema } from './list-dids';
import { ListFileReplicasSchema } from './list-file-replicas';
import { ListRsesSchema } from './list-rses';
import { ListRuleReplicaLockStatesSchema } from './list-rule-replica-lock-states';
import { ListRulesSchema } from './list-rules';
import { ListRulesPendingApprovalSchema } from './list-rules-pending-approval';
import { ListSubscriptionSchema } from './list-subscription';
import { ListSubscriptionRuleStatesSchema } from './list-subscription-rule-states';
import { ListSuspiciousReplicasSchema } from './list-suspicious-replicas';
import { SetAccountLimitSchema } from './set-account-limit';
import { SetDidStatusSchema } from './set-did-status';
import { UpdateAccountSchema } from './update-account';
import { UpdateAccountAttributeSchema } from './update-account-attribute';
import { UpdateRuleSchema } from './update-rule';

export * from './add-account-attribute';
export * from './add-account-identity';
export * from './add-did';
export * from './attach-dids';
export * from './create-account';
export * from './create-rule';
export * from './declare-bad-replicas';
export * from './delete-account';
export * from './delete-account-attribute';
export * from './delete-account-identity';
export * from './delete-account-limit';
export * from './get-account-info';
export * from './get-account-quotas';
export * from './get-ami-tag-info';
export * from './get-assistant-config';
export * from './get-ddm-link';
export * from './get-did-keyvaluepairs';
export * from './get-did-meta';
export * from './get-fts-link';
export * from './get-panda-task-link';
export * from './get-rse';
export * from './get-rse-attributes';
export * from './get-rse-protocols';
export * from './get-rse-usage';
export * from './get-rule';
export * from './get-site-header';
export * from './get-subscription';
export * from './list-account-attributes';
export * from './list-account-identities';
export * from './list-account-rse-quotas';
export * from './list-account-rse-usage';
export * from './list-accounts';
export * from './list-all-rses';
export * from './list-dataset-replicas';
export * from './list-did-contents';
export * from './list-did-parents';
export * from './list-did-rules';
export * from './list-dids';
export * from './list-file-replicas';
export * from './list-rses';
export * from './list-rule-replica-lock-states';
export * from './list-rules';
export * from './list-rules-pending-approval';
export * from './list-subscription';
export * from './list-subscription-rule-states';
export * from './list-suspicious-replicas';
export * from './set-account-limit';
export * from './set-did-status';
export * from './update-account';
export * from './update-account-attribute';
export * from './update-rule';
export { firstInvalidField, parseQuery, searchParamsToRecord } from './parse';
export type { QueryRecord } from './parse';

/** Every non-mock route under src/app/api/feature, by directory name. */
export const API_ROUTE_NAMES = [
    'add-account-attribute',
    'add-account-identity',
    'add-did',
    'attach-dids',
    'create-account',
    'create-rule',
    'declare-bad-replicas',
    'delete-account',
    'delete-account-attribute',
    'delete-account-identity',
    'delete-account-limit',
    'get-account-info',
    'get-account-quotas',
    'get-ami-tag-info',
    'get-assistant-config',
    'get-ddm-link',
    'get-did-keyvaluepairs',
    'get-did-meta',
    'get-fts-link',
    'get-panda-task-link',
    'get-rse',
    'get-rse-attributes',
    'get-rse-protocols',
    'get-rse-usage',
    'get-rule',
    'get-site-header',
    'get-subscription',
    'list-account-attributes',
    'list-account-identities',
    'list-account-rse-quotas',
    'list-account-rse-usage',
    'list-accounts',
    'list-all-rses',
    'list-dataset-replicas',
    'list-did-contents',
    'list-did-parents',
    'list-did-rules',
    'list-dids',
    'list-file-replicas',
    'list-rses',
    'list-rule-replica-lock-states',
    'list-rules',
    'list-rules-pending-approval',
    'list-subscription',
    'list-subscription-rule-states',
    'list-suspicious-replicas',
    'set-account-limit',
    'set-did-status',
    'update-account',
    'update-account-attribute',
    'update-rule',
] as const;

export type RouteName = (typeof API_ROUTE_NAMES)[number];

/** Request schema per route: the query for GET routes, the JSON body otherwise. */
export const API_SCHEMAS: Record<RouteName, z.ZodType> = {
    'add-account-attribute': AddAccountAttributeSchema,
    'add-account-identity': AddAccountIdentitySchema,
    'add-did': AddDidSchema,
    'attach-dids': AttachDidsSchema,
    'create-account': CreateAccountSchema,
    'create-rule': CreateRuleSchema,
    'declare-bad-replicas': DeclareBadReplicasSchema,
    'delete-account': DeleteAccountSchema,
    'delete-account-attribute': DeleteAccountAttributeSchema,
    'delete-account-identity': DeleteAccountIdentitySchema,
    'delete-account-limit': DeleteAccountLimitSchema,
    'get-account-info': GetAccountInfoSchema,
    'get-account-quotas': GetAccountQuotasSchema,
    'get-ami-tag-info': GetAmiTagInfoSchema,
    'get-assistant-config': GetAssistantConfigSchema,
    'get-ddm-link': GetDdmLinkSchema,
    'get-did-keyvaluepairs': GetDidKeyvaluepairsSchema,
    'get-did-meta': GetDidMetaSchema,
    'get-fts-link': GetFtsLinkSchema,
    'get-panda-task-link': GetPandaTaskLinkSchema,
    'get-rse': GetRseSchema,
    'get-rse-attributes': GetRseAttributesSchema,
    'get-rse-protocols': GetRseProtocolsSchema,
    'get-rse-usage': GetRseUsageSchema,
    'get-rule': GetRuleSchema,
    'get-site-header': GetSiteHeaderSchema,
    'get-subscription': GetSubscriptionSchema,
    'list-account-attributes': ListAccountAttributesSchema,
    'list-account-identities': ListAccountIdentitiesSchema,
    'list-account-rse-quotas': ListAccountRseQuotasSchema,
    'list-account-rse-usage': ListAccountRseUsageSchema,
    'list-accounts': ListAccountsSchema,
    'list-all-rses': ListAllRsesSchema,
    'list-dataset-replicas': ListDatasetReplicasSchema,
    'list-did-contents': ListDidContentsSchema,
    'list-did-parents': ListDidParentsSchema,
    'list-did-rules': ListDidRulesSchema,
    'list-dids': ListDidsSchema,
    'list-file-replicas': ListFileReplicasSchema,
    'list-rses': ListRsesSchema,
    'list-rule-replica-lock-states': ListRuleReplicaLockStatesSchema,
    'list-rules': ListRulesSchema,
    'list-rules-pending-approval': ListRulesPendingApprovalSchema,
    'list-subscription': ListSubscriptionSchema,
    'list-subscription-rule-states': ListSubscriptionRuleStatesSchema,
    'list-suspicious-replicas': ListSuspiciousReplicasSchema,
    'set-account-limit': SetAccountLimitSchema,
    'set-did-status': SetDidStatusSchema,
    'update-account': UpdateAccountSchema,
    'update-account-attribute': UpdateAccountAttributeSchema,
    'update-rule': UpdateRuleSchema,
};
