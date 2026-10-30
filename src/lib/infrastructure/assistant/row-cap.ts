export const DEFAULT_ROW_CAP = 50_000;
export const LOW_MEMORY_ROW_CAP = 10_000;

/** 50,000 rows, or 10,000 when the browser reports 4 GB of memory or less. */
export function defaultRowCap(deviceMemory: number | undefined = readDeviceMemory()): number {
    return deviceMemory !== undefined && deviceMemory <= 4 ? LOW_MEMORY_ROW_CAP : DEFAULT_ROW_CAP;
}

function readDeviceMemory(): number | undefined {
    if (typeof navigator === 'undefined') return undefined;
    const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return typeof value === 'number' ? value : undefined;
}
