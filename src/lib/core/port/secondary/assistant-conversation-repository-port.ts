import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';

export interface AssistantConversationRepositoryPort {
    listConversations(accountKey: string): Promise<Conversation[]>; // newest first
    getConversation(id: string): Promise<Conversation | undefined>;
    saveConversation(conversation: Conversation): Promise<void>;
    deleteConversation(id: string): Promise<void>; // also deletes its messages
    deleteAll(accountKey?: string): Promise<void>; // undefined = every account
    listMessages(conversationId: string): Promise<ChatMessage[]>; // oldest first
    saveMessage(message: ChatMessage): Promise<void>; // insert or replace by id
    estimateSizes(accountKey: string): Promise<{ perConversation: Record<string, number>; totalBytes: number }>;
    // returns deleted conversation ids; protectedIds (the open conversation) are never deleted but still count toward the size limit
    enforceRetention(policy: RetentionSettings, now: Date, protectedIds?: readonly string[]): Promise<string[]>;
}
