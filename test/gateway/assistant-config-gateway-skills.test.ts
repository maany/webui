import fs from 'fs';
import os from 'os';
import path from 'path';
import AssistantConfigGateway from '@/lib/infrastructure/gateway/assistant-config-gateway';
import EnvConfigGateway from '@/lib/infrastructure/gateway/env-config-gateway';

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} for this deployment.\n---\nUse the local naming rules.\n`;

describe('AssistantConfigGateway operator skills', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-config-skills-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        delete process.env.ASSISTANT_SKILLS_DIR;
        jest.restoreAllMocks();
    });

    it('serves no operator skills when ASSISTANT_SKILLS_DIR is unset', async () => {
        const config = await new AssistantConfigGateway(new EnvConfigGateway()).getAssistantConfig();
        expect(config.operatorSkills).toEqual([]);
    });

    it('serves the valid skills of ASSISTANT_SKILLS_DIR and logs the invalid ones', async () => {
        fs.mkdirSync(path.join(dir, 'atlas-naming'));
        fs.writeFileSync(path.join(dir, 'atlas-naming', 'SKILL.md'), skillMd('atlas-naming'));
        fs.mkdirSync(path.join(dir, 'Bad_Name'));
        fs.writeFileSync(path.join(dir, 'Bad_Name', 'SKILL.md'), skillMd('Bad_Name'));
        process.env.ASSISTANT_SKILLS_DIR = dir;
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const config = await new AssistantConfigGateway(new EnvConfigGateway()).getAssistantConfig();

        expect(config.operatorSkills).toEqual([
            { name: 'atlas-naming', description: 'atlas-naming for this deployment.', body: 'Use the local naming rules.', source: 'operator' },
        ]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[assistant] Skipping operator skill "Bad_Name"'));
    });
});
