import type { AssistantEvent, AssistantEventListener } from '@/lib/core/entity/assistant/events';

export interface AssistantEventBus {
    emit(event: AssistantEvent): void;
    subscribe(listener: AssistantEventListener): () => void;
}

/**
 * Synchronous in-memory pub/sub for assistant events.
 * A throwing listener never breaks the turn or the other listeners.
 */
export function createAssistantEventBus(): AssistantEventBus {
    const listeners = new Set<AssistantEventListener>();
    return {
        emit(event) {
            for (const listener of Array.from(listeners)) {
                try {
                    listener(event);
                } catch (error) {
                    console.error('Assistant event listener failed:', error);
                }
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
