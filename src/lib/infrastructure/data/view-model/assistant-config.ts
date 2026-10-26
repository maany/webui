import { BaseViewModel } from '@/lib/sdk/view-models';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';

export type AssistantConfigErrorType = 'config_unavailable' | 'unknown';

/** Flat AssistantConfig plus status; fields are absent on error. Contains no secrets. */
export interface AssistantConfigViewModel extends BaseViewModel, Partial<AssistantConfig> {
    errorType?: AssistantConfigErrorType;
}
