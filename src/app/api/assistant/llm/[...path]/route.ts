import { NextRequest } from 'next/server';
import { relayLlmRequest } from '@/lib/infrastructure/assistant/llm-relay';

type RelayContext = { params: Promise<{ path: string[] }> };

/** GET /api/assistant/llm/models (openai-compatible operator upstream only) */
export async function GET(request: NextRequest, { params }: RelayContext) {
    const { path } = await params;
    return relayLlmRequest(request, path);
}

/** POST /api/assistant/llm/chat/completions or /api/assistant/llm/v1/messages, depending on ASSISTANT_DEFAULT_PROVIDER_KIND */
export async function POST(request: NextRequest, { params }: RelayContext) {
    const { path } = await params;
    return relayLlmRequest(request, path);
}
