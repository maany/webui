'use client';

import { ListSubscription } from '@/component-library/pages/Subscriptions/list/ListSubscription';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SiteHeaderViewModel } from '@/lib/infrastructure/data/view-model/site-header';
import { usePageAction } from '@/lib/infrastructure/hooks/usePageAction';
import {
    SUBSCRIPTIONS_FILTER_ACTION,
    SUBSCRIPTIONS_FILTER_DESCRIPTION,
    SubscriptionsFilterSchema,
    subscriptionsFilterTarget,
} from '@/lib/infrastructure/assistant/page-actions/list-actions';

export interface ListSubscriptionClientProps {
    accountFilter?: string;
    autoSearch?: boolean;
}

export const ListSubscriptionClient = (props: ListSubscriptionClientProps) => {
    const router = useRouter();
    const pathname = usePathname();
    const hasUpdatedUrl = useRef(false);

    // Set by the subscriptions.filter page action. ListSubscription only auto-searches on mount,
    // so a new searchKey remounts it for the new account.
    const [override, setOverride] = useState<{ account: string; against: string | undefined } | null>(null);
    const [searchKey, setSearchKey] = useState(0);

    usePageAction({
        name: SUBSCRIPTIONS_FILTER_ACTION,
        description: SUBSCRIPTIONS_FILTER_DESCRIPTION,
        schema: SubscriptionsFilterSchema,
        apply: async args => {
            const target = subscriptionsFilterTarget(args);
            hasUpdatedUrl.current = true;
            setOverride({ account: target.account, against: props.accountFilter });
            setSearchKey(previous => previous + 1);
            router.replace(target.url, { scroll: false });
            return target.summary;
        },
    });

    // Fetch site header to get active account if accountFilter is not provided
    const querySiteHeader = async () => {
        const res = await fetch('/api/feature/get-site-header');
        return res.json();
    };

    const { data: siteHeader, isFetching: isSiteHeaderFetching } = useQuery<SiteHeaderViewModel>({
        queryKey: ['subscription-account-client'],
        queryFn: querySiteHeader,
        retry: false,
        refetchOnWindowFocus: false,
        enabled: !props.accountFilter, // Only fetch if accountFilter is not provided
    });

    // The override is dropped once a later, different accountFilter prop arrives (an in-app link)
    const accountOverride =
        override && (props.accountFilter === undefined || props.accountFilter === override.against || props.accountFilter === override.account)
            ? override.account
            : null;

    // Determine the account to use
    const account = accountOverride || props.accountFilter || siteHeader?.activeAccount?.rucioAccount;

    // Update URL to include account and autoSearch parameters
    useEffect(() => {
        if (!hasUpdatedUrl.current && account && !isSiteHeaderFetching) {
            hasUpdatedUrl.current = true;

            // Build URL parameters
            const urlParams = new URLSearchParams();
            urlParams.set('account', account);
            urlParams.set('autoSearch', 'true');

            // Update the URL using router.replace (doesn't add to history)
            const newUrl = `${pathname}?${urlParams.toString()}`;
            router.replace(newUrl);
        }
    }, [account, isSiteHeaderFetching, pathname, router]);

    return <ListSubscription key={searchKey} accountFilter={account} autoSearch={accountOverride !== null || props.autoSearch !== false} />;
};
