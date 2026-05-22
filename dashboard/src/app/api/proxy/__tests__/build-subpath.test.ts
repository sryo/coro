import { describe, it, expect } from 'vitest';
import { buildSubpath } from '../build-subpath';

describe('proxy buildSubpath', () => {
    it('accepts ordinary segments', () => {
        expect(buildSubpath(['projects', 'abc', 'cards'])).toBe('/projects/abc/cards');
    });

    it('rejects traversal', () => {
        expect(buildSubpath(['..'])).toBeNull();
        expect(buildSubpath(['projects', '..', 'admin'])).toBeNull();
        expect(buildSubpath(['.'])).toBeNull();
    });

    it('rejects empty segments', () => {
        expect(buildSubpath([''])).toBeNull();
        expect(buildSubpath(['projects', ''])).toBeNull();
    });

    it('rejects absolute-path segments and scheme-bearing values', () => {
        expect(buildSubpath(['/etc/passwd'])).toBeNull();
        expect(buildSubpath(['http://evil.com'])).toBeNull();
        expect(buildSubpath(['projects', 'https://x'])).toBeNull();
    });

    it('rejects control characters that could redirect or inject headers', () => {
        expect(buildSubpath(['projects\\admin'])).toBeNull();
        expect(buildSubpath(['projects\nset-cookie:x'])).toBeNull();
        expect(buildSubpath(['projects\r'])).toBeNull();
        expect(buildSubpath(['projects\0'])).toBeNull();
    });
});
