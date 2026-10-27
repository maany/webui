import { SENSITIVE_PLACEHOLDER, maskSensitiveArgs } from '@/lib/infrastructure/assistant/approvals';

describe('maskSensitiveArgs', () => {
    it('masks top-level sensitive keys only', () => {
        expect(maskSensitiveArgs({ account: 'jdoe', password: 's3cret' }, ['password'])).toEqual({
            account: 'jdoe',
            password: SENSITIVE_PLACEHOLDER,
        });
        expect(maskSensitiveArgs({ account: 'jdoe', nested: { password: 'x' } }, ['password'])).toEqual({
            account: 'jdoe',
            nested: { password: 'x' },
        });
    });

    it('does not mutate the input', () => {
        const args = { account: 'jdoe', password: 's3cret' };
        maskSensitiveArgs(args, ['password']);
        expect(args.password).toBe('s3cret');
    });

    it('leaves args without sensitive values and non-objects alone', () => {
        const args = { account: 'jdoe' };
        expect(maskSensitiveArgs(args, ['password'])).toEqual({ account: 'jdoe' });
        expect(maskSensitiveArgs(args, [])).toBe(args);
        expect(maskSensitiveArgs('text', ['password'])).toBe('text');
        expect(maskSensitiveArgs(null, ['password'])).toBeNull();
    });
});

describe('maskSensitiveArgs with an invalid-args marker', () => {
    it('masks the args the model sent inside the marker', () => {
        const marker = { __rucio_invalid_args: { message: 'Invalid arguments: x', received: { account: 'jdoe', password: 's3cret' } } };
        expect(maskSensitiveArgs(marker, ['password'])).toEqual({
            __rucio_invalid_args: { message: 'Invalid arguments: x', received: { account: 'jdoe', password: SENSITIVE_PLACEHOLDER } },
        });
    });
});
