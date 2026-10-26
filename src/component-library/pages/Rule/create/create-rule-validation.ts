import { CreateRuleGrouping, CreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { RSEAccountUsageLimitViewModel } from '@/lib/infrastructure/data/view-model/rse';

export type CreateRuleOptionsErrors = {
    tooManyCopies: boolean;
    copiesInvalid: boolean;
    lifetimeInvalid: boolean;
    commentsEmpty: boolean;
    groupingInvalid: boolean;
    sampleCountInvalid: boolean;
};

export const getEmptyOptionsErrors = (): CreateRuleOptionsErrors => {
    return {
        commentsEmpty: false,
        copiesInvalid: false,
        groupingInvalid: false,
        lifetimeInvalid: false,
        tooManyCopies: false,
        sampleCountInvalid: false,
    };
};

export function getTotalDataSize(parameters: Pick<CreateRuleParameters, 'dids'>): number {
    return parameters.dids.reduce((accumulator, current) => accumulator + current.bytes, 0);
}

export function isRSESufficient(rse: RSEAccountUsageLimitViewModel, totalDataSize: number): boolean {
    if (rse.bytes_remaining >= totalDataSize) return true;
    // if the bytes_limit is -1, it means there is no limit (infinite quota)
    return rse.bytes_limit === -1 && rse.has_quota;
}

/** Same rule as the RSE stage: chosen RSEs, none of which can hold the data. */
export function computeNeedsApproval(rses: RSEAccountUsageLimitViewModel[], totalDataSize: number): boolean {
    return rses.length > 0 && !rses.some(rse => isRSESufficient(rse, totalDataSize));
}

export function computeOptionsErrors(parameters: CreateRuleParameters): CreateRuleOptionsErrors {
    const totalDataSize = getTotalDataSize(parameters);
    const errors = getEmptyOptionsErrors();
    const { copies, daysLifetime, grouping, comments } = parameters;

    errors.copiesInvalid = isNaN(copies) || copies < 1 || copies > parameters.rses.length;
    errors.tooManyCopies = !parameters.askApproval && parameters.rses.filter(rse => isRSESufficient(rse, totalDataSize)).length < copies;
    errors.lifetimeInvalid = daysLifetime !== undefined && (isNaN(daysLifetime) || daysLifetime < 1);
    errors.commentsEmpty = parameters.askApproval && !comments;
    errors.groupingInvalid =
        grouping !== undefined &&
        grouping !== CreateRuleGrouping.DATASET &&
        grouping !== CreateRuleGrouping.ALL &&
        grouping !== CreateRuleGrouping.NONE;
    errors.sampleCountInvalid =
        parameters.sample && (!parameters.sampleFileCount || isNaN(parameters.sampleFileCount) || parameters.sampleFileCount < 1);

    return errors;
}

export function hasOptionsErrors(errors: CreateRuleOptionsErrors): boolean {
    return Object.values(errors).some(Boolean);
}
