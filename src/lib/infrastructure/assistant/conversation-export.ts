import type { ChatMessage, Conversation, MessagePart } from '@/lib/core/entity/assistant/conversation';

function partToMarkdown(part: MessagePart): string | undefined {
    switch (part.type) {
        case 'text':
            return part.text;
        case 'reasoning':
            return undefined;
        case 'tool-call': {
            const outcome = part.error ? `${part.status}: ${part.error.error}` : part.status;
            return [
                `> Tool \`${part.toolName}\` (${outcome})`,
                '>',
                '> ```json',
                ...JSON.stringify(part.args ?? {}, null, 2)
                    .split('\n')
                    .map(line => `> ${line}`),
                '> ```',
            ].join('\n');
        }
        case 'approval':
            return `> Approval: ${part.decision} (${part.scope}) by ${part.approver} at ${part.at}`;
        case 'page-context':
            return `> Page: ${part.context.route}`;
        case 'notice':
            return `_${part.text}_`;
    }
}

export function conversationToMarkdown(conversation: Conversation, messages: ChatMessage[]): string {
    const lines = [
        `# ${conversation.title}`,
        '',
        `- Account: ${conversation.accountKey}`,
        `- Model: ${conversation.model}`,
        `- Created: ${conversation.createdAt}`,
        `- Updated: ${conversation.updatedAt}`,
        '',
    ];
    for (const message of messages) {
        lines.push(`## ${message.role === 'user' ? 'You' : 'Rucio bot'}`, '');
        for (const part of message.parts) {
            const text = partToMarkdown(part);
            if (text) lines.push(text, '');
        }
    }
    return lines.join('\n');
}

export function conversationToJson(conversation: Conversation, messages: ChatMessage[]): string {
    return JSON.stringify({ format: 'rucio-assistant-conversation', version: 1, conversation, messages }, null, 2);
}

export function exportFileName(conversation: Conversation, extension: 'md' | 'json'): string {
    const slug =
        conversation.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'conversation';
    return `rucio-bot-${slug}-${conversation.updatedAt.slice(0, 10)}.${extension}`;
}

/** Saves text as a file through a temporary download link. */
export function downloadText(fileName: string, mimeType: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
