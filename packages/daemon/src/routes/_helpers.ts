import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type ErrorExtras = {
    hint?: string;
    allowed?: string[];
    conflicts?: string[];
    dirty_files?: number;
};

/**
 * Map known controller / route error codes to HTTP status codes. Everything
 * not in the table defaults to 409 (the most common "you can't do that right
 * now" case for state-machine rejections). 404s are limited to lookup misses.
 */
const STATUS_BY_CODE: Record<string, number> = {
    not_found: 404,
    card_not_found: 404,
    stage_not_found: 404,
    project_not_found: 404,
    no_worktree: 404,
    bad_request: 400,
    unbound: 404,
    invalid_stages: 400,
};

export function errorStatus(code: string): number {
    return STATUS_BY_CODE[code] ?? 409;
}

export function httpError(
    c: Context,
    status: ContentfulStatusCode,
    code: string,
    message: string,
    extras: ErrorExtras = {},
) {
    const body = {
        error: {
            code,
            message,
            ...(extras.hint !== undefined ? { hint: extras.hint } : {}),
            ...(extras.allowed !== undefined ? { allowed: extras.allowed } : {}),
            ...(extras.conflicts !== undefined ? { conflicts: extras.conflicts } : {}),
            ...(extras.dirty_files !== undefined ? { dirty_files: extras.dirty_files } : {}),
        },
    };
    return c.json(body, status);
}
