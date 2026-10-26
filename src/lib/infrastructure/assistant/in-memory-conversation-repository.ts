import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { jsonBytes, selectConversationsToEvict } from '@/lib/core/services/assistant-retention';

/** Used when IndexedDB is unavailable (for example private browsing). Data lives until the tab closes. */
export class InMemoryConversationRepository implements AssistantConversationRepositoryPort {
    private readonly conversations = new Map<string, Conversation>();
    private readonly messages = new Map<string, ChatMessage>();

    async listConversations(accountKey: string): Promise<Conversation[]> {
        return Array.from(this.conversations.values())
            .filter(conversation => conversation.accountKey === accountKey)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getConversation(id: string): Promise<Conversation | undefined> {
        return this.conversations.get(id);
    }

    async saveConversation(conversation: Conversation): Promise<void> {
        this.conversations.set(conversation.id, conversation);
    }

    async deleteConversation(id: string): Promise<void> {
        this.conversations.delete(id);
        for (const message of Array.from(this.messages.values())) {
            if (message.conversationId === id) this.messages.delete(message.id);
        }
    }

    async deleteAll(accountKey?: string): Promise<void> {
        for (const conversation of Array.from(this.conversations.values())) {
            if (accountKey === undefined || conversation.accountKey === accountKey) await this.deleteConversation(conversation.id);
        }
    }

    async listMessages(conversationId: string): Promise<ChatMessage[]> {
        return Array.from(this.messages.values())
            .filter(message => message.conversationId === conversationId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async saveMessage(message: ChatMessage): Promise<void> {
        this.messages.set(message.id, message);
    }

    async deleteMessage(id: string): Promise<void> {
        this.messages.delete(id);
    }

    private async conversationBytes(conversation: Conversation): Promise<number> {
        const messages = await this.listMessages(conversation.id);
        return jsonBytes(conversation) + messages.reduce((sum, message) => sum + jsonBytes(message), 0);
    }

    async estimateSizes(accountKey: string): Promise<{ perConversation: Record<string, number>; totalBytes: number }> {
        const perConversation: Record<string, number> = {};
        let totalBytes = 0;
        for (const conversation of await this.listConversations(accountKey)) {
            const bytes = await this.conversationBytes(conversation);
            perConversation[conversation.id] = bytes;
            totalBytes += bytes;
        }
        return { perConversation, totalBytes };
    }

    async enforceRetention(policy: RetentionSettings, now: Date, protectedIds: readonly string[] = []): Promise<string[]> {
        const candidates = await Promise.all(
            Array.from(this.conversations.values()).map(async conversation => ({
                id: conversation.id,
                accountKey: conversation.accountKey,
                updatedAt: conversation.updatedAt,
                bytes: await this.conversationBytes(conversation),
            })),
        );
        const evicted = selectConversationsToEvict(candidates, policy, now, protectedIds);
        for (const id of evicted) await this.deleteConversation(id);
        return evicted;
    }
}
