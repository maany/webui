import { z } from 'zod';
import { MAX_AMI_TAGS_PER_REQUEST, parseAmiTagsParam } from '@/lib/core/utils/ami-tag-utils';

const INVALID_TAGS = `Invalid parameter: tags must be 1 to ${MAX_AMI_TAGS_PER_REQUEST} comma-separated AMI tags`;

/**
 * GET /api/feature/get-ami-tag-info query. `tags` is a comma-separated list of AMI tags, e.g. `f1723,m2281`,
 * or a repeated key. The parsed result holds the cleaned, de-duplicated tag list.
 */
export const GetAmiTagInfoSchema = z.object({
    tags: z.union([z.string(), z.array(z.string())], INVALID_TAGS).transform((raw, ctx) => {
        const tags = parseAmiTagsParam(raw);
        if (!tags) {
            ctx.addIssue({ code: 'custom', message: INVALID_TAGS });
            return z.NEVER;
        }
        return tags;
    }),
});

export type GetAmiTagInfoInput = z.infer<typeof GetAmiTagInfoSchema>;
