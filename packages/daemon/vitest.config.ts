import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'daemon',
        include: ['src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
});
