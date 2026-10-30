'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListRSE } from '@/component-library/pages/RSE/list/ListRSE';
import { usePageAction } from '@/lib/infrastructure/hooks/usePageAction';
import {
    RSES_FILTER_ACTION,
    RSES_FILTER_DESCRIPTION,
    RsesFilterSchema,
    rsesFilterTarget,
} from '@/lib/infrastructure/assistant/page-actions/list-actions';

export interface ListRSEClientProps {
    initialExpression?: string;
    autoSearch?: boolean;
}

/** Route-level client for /rses: offers rses.filter and remounts ListRSE so it searches again. */
export const ListRSEClient = (props: ListRSEClientProps) => {
    const router = useRouter();
    const [override, setOverride] = useState<string | null>(null);
    const [searchKey, setSearchKey] = useState(0);

    usePageAction({
        name: RSES_FILTER_ACTION,
        description: RSES_FILTER_DESCRIPTION,
        schema: RsesFilterSchema,
        apply: async args => {
            const target = rsesFilterTarget(args);
            setOverride(target.expression);
            setSearchKey(previous => previous + 1);
            router.replace(target.url, { scroll: false });
            return target.summary;
        },
    });

    return (
        <ListRSE key={searchKey} initialExpression={override ?? props.initialExpression} autoSearch={override !== null ? true : props.autoSearch} />
    );
};
