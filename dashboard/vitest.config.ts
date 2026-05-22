import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The dashboard's only Node-side test is the proxy URL guard. Vitest runs from
// the workspace root via the projects[] list; this config sets up the @/ alias
// so the test file resolves dashboard sources the same way Next.js does.
export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
});
