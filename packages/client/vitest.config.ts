import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'client',
        include: ['src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
});
