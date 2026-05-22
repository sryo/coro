// Validate path segments for the daemon proxy. Rejects anything that could
// let a caller redirect the upstream fetch off `localhost:<port>`:
// traversal segments, absolute paths, scheme-bearing values, backslashes
// (some URL parsers treat them as separators), null bytes, and CR/LF
// (header injection if a downstream consumer concatenated them).
export function buildSubpath(parts: string[]): string | null {
    for (const p of parts) {
        if (p === '' || p === '.' || p === '..') return null;
        if (p.startsWith('/') || p.includes('://')) return null;
        if (p.includes('\\') || p.includes('\0') || p.includes('\n') || p.includes('\r')) return null;
    }
    return '/' + parts.join('/');
}
