export type SkillSourceKind = 'shipped' | 'operator' | 'user';

export interface SkillDefinition {
    name: string; // kebab-case, unique after collision resolution
    description: string;
    body: string; // markdown after frontmatter
    allowedTools?: string[];
    source: SkillSourceKind;
}
