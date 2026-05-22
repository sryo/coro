import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

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

export type ParseBodyResult<T> =
    | { ok: true; data: T }
    | { ok: false; message: string };

/**
 * Parse a request body against a zod schema. Returns the data or a single
 * joined message ready to feed to httpError(c, 400, 'bad_request', message).
 * Routes can early-return on !ok without an extra wrapper helper.
 *
 * When `allowEmpty` is true, a missing/invalid body is treated as `{}` so
 * the schema's defaults / optional fields decide the shape. Use this for
 * endpoints (merge, abandon) where every field is optional.
 */
export async function parseJsonBody<T>(
    c: Context,
    schema: z.ZodType<T>,
    opts: { allowEmpty?: boolean } = {},
): Promise<ParseBodyResult<T>> {
    const raw = await c.req.json().catch(() => null);
    const input = raw === null && opts.allowEmpty ? {} : raw;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        const message = parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ');
        return { ok: false, message };
    }
    return { ok: true, data: parsed.data };
}
