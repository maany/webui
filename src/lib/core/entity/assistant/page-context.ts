export interface PageContext {
    route: string; // pathname, e.g. '/rule/abc123'
    params: Record<string, string>; // search params
    title: string;
    accountKey: string; // `${account}@${vo}`
    summary?: string; // from usePageDescribe, max 500 chars
}
