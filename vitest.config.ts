import { defineConfig } from 'vitest/config';

// Workspace-style projects so `vitest run` picks up suites from every package
// that has them. The types package is declaration-only — no tests live there.
export default defineConfig({
    test: {
        projects: [
            'packages/core',
            'packages/client',
            'packages/daemon',
        ],
    },
});
