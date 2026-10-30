import { Children, isValidElement, ReactNode } from 'react';

const notFoundMock = jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
});
jest.mock('next/navigation', () => ({ notFound: () => notFoundMock() }));
jest.mock('@/component-library/features/assistant/settings/AssistantSettings', () => ({ AssistantSettings: () => null }));

import Page, { metadata } from '@/app/(rucio)/assistant/settings/page';
import { AssistantSettings } from '@/component-library/features/assistant/settings/AssistantSettings';

function containsType(node: ReactNode, type: unknown): boolean {
    if (!isValidElement(node)) return false;
    if (node.type === type) return true;
    return Children.toArray((node.props as { children?: ReactNode }).children).some(child => containsType(child, type));
}

describe('/assistant/settings page', () => {
    afterEach(() => {
        delete process.env.FEATURE_ASSISTANT;
        notFoundMock.mockClear();
    });

    it('is not found while the assistant flag is off (default)', async () => {
        await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
        expect(notFoundMock).toHaveBeenCalledTimes(1);
    });

    it('renders the settings container when the assistant flag is on', async () => {
        process.env.FEATURE_ASSISTANT = 'true';
        const tree = await Page();
        expect(notFoundMock).not.toHaveBeenCalled();
        expect(containsType(tree, AssistantSettings)).toBe(true);
    });

    it('has a page title', () => {
        expect(metadata.title).toBe('Rucio bot settings - Rucio');
    });
});
