// eslint-config-next 16 ships native flat config. Import the core-web-vitals
// preset directly instead of going through FlatCompat (which trips a circular
// JSON validation error on this version).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
    ...nextCoreWebVitals,
    {
        ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
    },
];

export default config;
