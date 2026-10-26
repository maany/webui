import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const EM_DASH = String.fromCharCode(0x2014);

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('Rucio bot copy', () => {
    it('has no em dashes in assistant UI or prompt files', () => {
        const roots = ['src/component-library/features/assistant', 'src/lib/infrastructure/assistant'];
        const offenders = roots.flatMap(files).filter(file => readFileSync(file, 'utf8').includes(EM_DASH));
        expect(offenders).toEqual([]);
    });
});
