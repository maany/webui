export interface DocHit {
    title: string;
    snippet: string;
    url: string;
    source: 'docs' | 'openapi';
    score: number;
}

export interface AssistantKnowledgeIndexPort {
    search(query: string, limit: number): Promise<DocHit[]>;
    metadata(): Promise<{ docsVersion: string; openapiVersion: string; builtAt: string } | undefined>;
}
