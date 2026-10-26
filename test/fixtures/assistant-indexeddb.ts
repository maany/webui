/**
 * fake-indexeddb needs structuredClone, which jsdom does not provide.
 * Import this module before anything that touches indexedDB.
 */
import { deserialize, serialize } from 'v8';

if (typeof globalThis.structuredClone !== 'function') {
    (globalThis as unknown as { structuredClone: (value: unknown) => unknown }).structuredClone = (value: unknown) => deserialize(serialize(value));
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('fake-indexeddb/auto');
