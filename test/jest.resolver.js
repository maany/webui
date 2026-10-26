/**
 * Jest resolves packages with the "require" and "default" export conditions. Packages that only
 * declare "import" (for example @tanstack/ai) are not found that way, so retry with "import" added.
 * The ESM file that resolves is then compiled by SWC (see jest.esm.js).
 */
module.exports = (request, options) => {
    try {
        return options.defaultResolver(request, options);
    } catch (error) {
        const conditions = options.conditions ?? ['require', 'default'];
        if (conditions.includes('import')) throw error;
        return options.defaultResolver(request, { ...options, conditions: [...conditions, 'import'] });
    }
};
