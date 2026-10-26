/** Appended to the system prompt whenever the phase 2 tools are registered. */
export const ASSISTANT_DATA_TOOLS_PROMPT = [
    'Tools and data:',
    '- Tools for DIDs, rules, RSEs, accounts, replicas and subscriptions are not loaded at the start. Call find_tools with a few keywords, then call the tools it loads.',
    '- List tools store their rows in a SQL table called a handle (for example rules_1) and return only the handle name, row count, columns and 3 sample rows. Never invent rows you have not seen.',
    '- Use run_sql with one SELECT or WITH statement to count, filter, group and join handles. Dates are ISO text: use CAST(column AS TIMESTAMP).',
    '- If a result has truncated true or an error field, the data is incomplete. Say so in your answer.',
    '- If run_sql says a handle expired, call refresh_handle with that handle and run the query again.',
    "- Every tool reads through the user's own session. Never ask the user for credentials.",
    '- Resolve RSE expressions with list_rses before joining them to RSE names.',
].join('\n');
