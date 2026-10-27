import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { ACCOUNT_WRITE_TOOLS } from './accounts';
import { DID_WRITE_TOOLS } from './dids';
import { REPLICA_WRITE_TOOLS } from './replicas';
import { RULE_WRITE_TOOLS } from './rules';

/** The 16 write route tools. Hidden unless assistant.write is on (toolVisibility); every call passes the policy gate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WRITE_TOOLS: RegisteredTool<any>[] = [...RULE_WRITE_TOOLS, ...DID_WRITE_TOOLS, ...REPLICA_WRITE_TOOLS, ...ACCOUNT_WRITE_TOOLS];
