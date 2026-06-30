'use client';

import { useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { GridReadyEvent, SelectionChangedEvent, ValueGetterParams } from 'ag-grid-community';
import { UseStreamReader } from '@/lib/infrastructure/hooks/useStreamReader';
import { StreamedTable } from '@/component-library/features/table/StreamedTable/StreamedTable';
import { DefaultTextFilterParams, DefaultDateFilterParams } from '@/component-library/features/utils/filter-parameters';
import * as Popover from '@radix-ui/react-popover';
import { DateCellRenderer } from '@/component-library/features/utils/DateWithTooltip';
import { ClickableCell } from '@/component-library/features/table/cells/ClickableCell';
import { Button } from '@/component-library/atoms/form/button';
import { HiOutlineBan, HiOutlineExternalLink } from 'react-icons/hi';
import { SuspiciousReplicaViewModel } from '@/lib/infrastructure/data/view-model/replica';
import type { DDMLinkViewModel } from '@/lib/infrastructure/data/view-model/request';

type SuspiciousReplicasTableProps = {
    streamingHook: UseStreamReader<SuspiciousReplicaViewModel>;
    onGridReady: (event: GridReadyEvent) => void;
    /** Per-row "Declare bad" action — opens the dialog for a single replica. */
    onDeclareBad: (replica: SuspiciousReplicaViewModel) => void;
    /** Notifies the parent of the current selection (multi-row checkboxes). */
    onSelectionChanged: (selected: SuspiciousReplicaViewModel[]) => void;
    featureDDMDashboard: boolean;
};

interface ActionsCellParams {
    data: SuspiciousReplicaViewModel | undefined;
    onDeclareBad: (replica: SuspiciousReplicaViewModel) => void;
    featureDDMDashboard: boolean;
}

const ActionsCell = ({ data, onDeclareBad, featureDDMDashboard }: ActionsCellParams) => {
    const [isFetchingDDM, setIsFetchingDDM] = useState<boolean>(false);

    if (!data || data.status !== 'success') return null;

    const openDDMDashboard = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsFetchingDDM(true);
        try {
            const response = await fetch(
                `/api/feature/get-ddm-link?scope=${encodeURIComponent(data.scope)}&name=${encodeURIComponent(data.name)}&rse=${encodeURIComponent(
                    data.rse,
                )}`,
            );
            const json: DDMLinkViewModel = await response.json();
            if (json.status === 'success' && json.url) {
                window.open(json.url, '_blank');
            }
        } finally {
            setIsFetchingDDM(false);
        }
    };

    return (
        <div className="flex items-center gap-1 h-full">
            <Button
                size="sm"
                variant="error"
                className="h-7 px-2 text-xs"
                onClick={e => {
                    e.stopPropagation();
                    onDeclareBad(data);
                }}
            >
                <HiOutlineBan className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Declare bad
            </Button>
            <Button
                size="sm"
                variant="neutral"
                className="h-7 px-2 text-xs"
                onClick={e => {
                    e.stopPropagation();
                    window.open(`/did/${encodeURIComponent(data.scope)}/${encodeURIComponent(data.name)}`, '_blank');
                }}
            >
                <HiOutlineExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                View
            </Button>
            {featureDDMDashboard && (
                <Button size="sm" variant="neutral" className="h-7 px-2 text-xs" onClick={openDDMDashboard} disabled={isFetchingDDM}>
                    <HiOutlineExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    DDM Dashboard
                </Button>
            )}
        </div>
    );
};

const ClickableDIDName = (props: { data: SuspiciousReplicaViewModel | undefined }) => {
    if (!props.data) return null;
    const { scope, name } = props.data;
    return <ClickableCell href={`/did/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`}>{name}</ClickableCell>;
};

const ClickableRSE = (props: { value: string }) => {
    if (!props.value) return null;
    return <ClickableCell href={`/rse/${encodeURIComponent(props.value)}`}>{props.value}</ClickableCell>;
};

const TruncatedReasonCell = (props: { value: string | undefined }) => {
    if (!props.value) return null;
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <span className="block truncate overflow-hidden text-ellipsis whitespace-nowrap max-w-full cursor-pointer">
                    {props.value}
                </span>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    className="z-50 max-w-sm rounded bg-neutral-800 p-2 text-sm text-white shadow-lg"
                    sideOffset={5}
                >
                    {props.value}
                    <Popover.Arrow className="fill-neutral-800" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
};

export const SuspiciousReplicasTable = (props: SuspiciousReplicasTableProps) => {
    const { onDeclareBad, onSelectionChanged, featureDDMDashboard, ...tableProps } = props;
    const tableRef = useRef<AgGridReact<SuspiciousReplicaViewModel>>(null);

    const columnDefs = useMemo(
        () => [
            {
                headerCheckboxSelection: true,
                headerCheckboxSelectionFilteredOnly: true,
                checkboxSelection: true,
                width: 48,
                minWidth: 48,
                maxWidth: 48,
                suppressMenu: true,
                sortable: false,
                filter: false,
                resizable: false,
            },
            {
                headerName: 'Scope',
                field: 'scope',
                flex: 1,
                minWidth: 140,
                filter: true,
                filterParams: DefaultTextFilterParams,
                sortable: true,
            },
            {
                headerName: 'Name',
                field: 'name',
                flex: 2,
                minWidth: 260,
                filter: true,
                filterParams: DefaultTextFilterParams,
                sortable: true,
                cellRenderer: ClickableDIDName,
            },
            {
                headerName: 'RSE',
                field: 'rse',
                flex: 1,
                minWidth: 180,
                filter: true,
                filterParams: DefaultTextFilterParams,
                sortable: true,
                cellRenderer: ClickableRSE,
            },
            {
                headerName: 'Created At',
                field: 'createdAt',
                flex: 1,
                minWidth: 180,
                cellRenderer: DateCellRenderer,
                filter: 'agDateColumnFilter',
                filterParams: DefaultDateFilterParams,
                sortable: true,
            },
            {
                headerName: 'Count',
                field: 'cnt',
                width: 100,
                minWidth: 100,
                filter: 'agNumberColumnFilter',
                sortable: true,
                sort: 'desc' as const,
            },
            {
                headerName: 'Last failure reason',
                field: 'reason',
                flex: 2,
                minWidth: 200,
                filter: true,
                filterParams: DefaultTextFilterParams,
                sortable: true,
                cellRenderer: TruncatedReasonCell,
            },
            {
                headerName: 'Actions',
                colId: 'actions',
                width: 300,
                minWidth: 300,
                sortable: false,
                filter: false,
                resizable: false,
                pinned: 'right' as const,
                cellRenderer: ActionsCell,
                cellRendererParams: { onDeclareBad, featureDDMDashboard },
                valueGetter: (params: ValueGetterParams<SuspiciousReplicaViewModel>) => params.data?.name,
            },
        ],
        [onDeclareBad, featureDDMDashboard],
    );

    const handleGridReady = (event: GridReadyEvent) => {
        tableProps.onGridReady(event);
        // Default sort: count descending (AC #5).
        event.api.applyColumnState({
            state: [{ colId: 'cnt', sort: 'desc' }],
            defaultState: { sort: null },
        });
    };

    const handleSelectionChanged = (event: SelectionChangedEvent<SuspiciousReplicaViewModel>) => {
        onSelectionChanged(event.api.getSelectedRows());
    };

    return (
        <StreamedTable
            columnDefs={columnDefs}
            tableRef={tableRef}
            streamingHook={tableProps.streamingHook}
            onGridReady={handleGridReady}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            onSelectionChanged={handleSelectionChanged}
        />
    );
};
