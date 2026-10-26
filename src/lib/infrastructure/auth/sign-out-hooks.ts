/**
 * Work that must finish before the user is signed out (for example clearing
 * Rucio bot history when "clear on logout" is on). Hooks run in parallel and a
 * failing or slow hook never blocks sign-out for more than `timeoutMs`.
 */
export type SignOutHook = () => Promise<void> | void;

const hooks = new Set<SignOutHook>();

export function registerSignOutHook(hook: SignOutHook): () => void {
    hooks.add(hook);
    return () => {
        hooks.delete(hook);
    };
}

export async function runSignOutHooks(timeoutMs: number = 3_000): Promise<void> {
    const runs = Array.from(hooks).map(async hook => {
        try {
            await hook();
        } catch (error) {
            console.error('Sign-out hook failed:', error);
        }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.all(runs).then(() => undefined), timeout]);
    clearTimeout(timer);
}
