import { nanoid } from 'nanoid';
import type { Message } from '@coro/types';
import { getDb } from './db';
import { emitEvent } from './events';
import { getCard, type Card } from './cards';
import { getProject } from './projects';
import { listStages } from './stages';
import { buildSystemPrompt, hashSystemPrompt } from './claude/prompt';
import { runClaude } from './claude/driver';
import type { ClaudeEvent } from './claude/types';

// MessageRow is the persisted Message shape; alias kept for backward-compat
// with existing core callers.
export type MessageRow = Message;
export type { Message } from '@coro/types';

interface ConversationRow {
    id: string;
    card_id: string;
    system_prompt_hash: string;
    created_at: number;
}

// per-card serial chain; different cards run in parallel
const cardChains = new Map<string, Promise<unknown>>();
// per-card abort controller so the daemon can interrupt the in-flight turn
const cardAborts = new Map<string, AbortController>();

const RATE_LIMIT_RE = /rate[\s_-]?limit|overloaded|429|too many requests/i;
const RETRY_AFTER_RE = /(?:retry[\s_-]?after[:\s]*|in\s+)(\d+)\s*(?:s|sec|seconds?)?/i;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 60_000;

export function classifyRateLimit(err: unknown): { isRateLimit: boolean; retryAfterMs?: number } {
    const msg = (err as { message?: string })?.message || String(err);
    if (!RATE_LIMIT_RE.test(msg)) return { isRateLimit: false };
    const m = msg.match(RETRY_AFTER_RE);
    const retryAfterMs = m ? parseInt(m[1], 10) * 1000 : undefined;
    return { isRateLimit: true, retryAfterMs };
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        const onAbort = () => {
            clearTimeout(t);
            signal.removeEventListener('abort', onAbort);
            reject(new Error('aborted'));
        };
        const t = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort);
    });
}

export function getConversationByCard(cardId: string): ConversationRow | null {
    const row = getDb().prepare('SELECT * FROM conversations WHERE card_id = ?').get(cardId) as ConversationRow | undefined;
    return row || null;
}

export function getOrCreateConversation(cardId: string, systemPromptHash: string): ConversationRow {
    const existing = getConversationByCard(cardId);
    if (existing) {
        if (existing.system_prompt_hash !== systemPromptHash) {
            getDb().prepare('UPDATE conversations SET system_prompt_hash = ? WHERE id = ?')
                .run(systemPromptHash, existing.id);
        }
        return existing;
    }
    const id = nanoid(10);
    getDb().prepare(`
        INSERT INTO conversations (id, card_id, system_prompt_hash, created_at)
        VALUES (?, ?, ?, ?)
    `).run(id, cardId, systemPromptHash, Date.now());
    return getConversationByCard(cardId)!;
}

interface AppendOpts {
    conversation_id: string;
    message_id?: string;
    turn_id: string;
    role: MessageRow['role'];
    content_text?: string | null;
    content_json?: unknown;
    tool_name?: string | null;
    streaming_complete?: boolean;
}

export function appendMessage(opts: AppendOpts): MessageRow {
    const messageId = opts.message_id || nanoid(12);
    const db = getDb();
    db.prepare(`
        INSERT INTO messages (conversation_id, message_id, turn_id, role, content_text, content_json, tool_name, streaming_complete, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        opts.conversation_id,
        messageId,
        opts.turn_id,
        opts.role,
        opts.content_text ?? null,
        opts.content_json !== undefined ? JSON.stringify(opts.content_json) : null,
        opts.tool_name ?? null,
        opts.streaming_complete ? 1 : 0,
        Date.now(),
    );
    const row = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(messageId) as MessageRow;
    return row;
}

export function listMessages(cardId: string, sinceId = 0, limit = 200): MessageRow[] {
    const conv = getConversationByCard(cardId);
    if (!conv) return [];
    return getDb()
        .prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
        .all(conv.id, sinceId, limit) as MessageRow[];
}

/**
 * Enqueue work on a card's serial chain. Different cards run in parallel; a
 * card's own messages are serialized. Errors don't break the chain — they're
 * caught and the next enqueued turn still runs.
 */
function enqueueOnChain<T>(cardId: string, fn: () => Promise<T>): Promise<T> {
    const prev = cardChains.get(cardId) || Promise.resolve();
    const next = prev.then(fn, fn);
    cardChains.set(cardId, next.catch(() => undefined));
    return next as Promise<T>;
}

export function abortTurn(cardId: string): boolean {
    const ac = cardAborts.get(cardId);
    if (!ac) return false;
    ac.abort();
    cardAborts.delete(cardId);
    return true;
}

/** Card ids currently mid-turn in-memory. Snapshot included in the SSE 'connected'
 * event so reconnecting dashboards can reconcile their streaming set against
 * actual daemon state (and unstick after a daemon restart). */
export function getStreamingCardIds(projectId?: string): string[] {
    const ids = Array.from(cardAborts.keys());
    if (!projectId) return ids;
    return ids.filter((id) => {
        const c = getCard(id);
        return c?.project_id === projectId;
    });
}

/** Called at daemon boot. Marks any turns the daemon was mid-flight on as
 * orphaned in the DB and emits a synthetic card:turn_failed so a still-open
 * dashboard tab (reconnecting after the restart) unsticks the streaming card.
 * In-memory state was already lost on the crash; this surfaces it. */
export function recoverOrphanedTurns(): number {
    const db = getDb();
    const rows = db
        .prepare("SELECT id, card_id, project_id FROM turns WHERE status = 'running'")
        .all() as Array<{ id: string; card_id: string; project_id: string }>;
    if (rows.length === 0) return 0;
    db.prepare("UPDATE turns SET status = 'orphaned', ended_at = ? WHERE status = 'running'")
        .run(Date.now());
    for (const r of rows) {
        emitEvent('card:turn_failed', {
            card_id: r.card_id,
            project_id: r.project_id,
            turn_id: r.id,
            message: 'daemon restarted; turn did not complete',
        });
    }
    return rows.length;
}

function recordTurnStart(turnId: string, card: Card): void {
    getDb()
        .prepare('INSERT INTO turns (id, card_id, project_id, started_at, status) VALUES (?, ?, ?, ?, ?)')
        .run(turnId, card.id, card.project_id, Date.now(), 'running');
}

function recordTurnEnd(turnId: string, status: 'complete' | 'failed'): void {
    getDb()
        .prepare("UPDATE turns SET status = ?, ended_at = ? WHERE id = ? AND status = 'running'")
        .run(status, Date.now(), turnId);
}

export interface SendMessageResult {
    user_message_id: string;
    turn_id: string;
    queued: boolean;
}

/**
 * Send a user message to the card's conversation and kick off the agent turn.
 * Returns immediately after persisting the user message; the turn runs async.
 * Subscribe to events.onEvent for live progress (or GET /cards/:id/stream).
 */
export function sendMessage(cardId: string, content: string, opts: { clientMessageId?: string } = {}): SendMessageResult {
    const card = getCard(cardId);
    if (!card) throw Object.assign(new Error('card not found'), { code: 'card_not_found' });
    if (!card.worktree_path) {
        throw Object.assign(new Error('card has no worktree; transition to an active stage first'), {
            code: 'card_not_active',
            hint: 'POST /cards/:id/transitions with to_stage_id of an "active" kind stage (or run /coro-start)',
        });
    }
    const project = getProject(card.project_id);
    if (!project) throw new Error('project missing for card');

    const stages = listStages(card.project_id);
    const systemPrompt = buildSystemPrompt(card, project, stages);
    const hash = hashSystemPrompt(systemPrompt);
    const conv = getOrCreateConversation(cardId, hash);
    const turnId = nanoid(8);

    const userRow = appendMessage({
        conversation_id: conv.id,
        message_id: opts.clientMessageId,
        turn_id: turnId,
        role: 'user',
        content_text: content,
        streaming_complete: true,
    });
    emitEvent('card:message', {
        card_id: cardId,
        project_id: card.project_id,
        message: userRow,
    });

    enqueueOnChain(cardId, () => runTurn(card, conv.id, turnId, content, systemPrompt, project.default_model || card.model_override))
        .catch((err) => {
            emitEvent('card:turn_failed', {
                card_id: cardId,
                project_id: card.project_id,
                turn_id: turnId,
                message: err?.message || String(err),
            });
        });

    return {
        user_message_id: userRow.message_id,
        turn_id: turnId,
        queued: true,
    };
}

async function runTurn(
    card: Card,
    conversationId: string,
    turnId: string,
    userMessage: string,
    systemPrompt: string,
    model: string | null | undefined,
): Promise<void> {
    if (!card.worktree_path) return;
    const ac = new AbortController();
    cardAborts.set(card.id, ac);
    recordTurnStart(turnId, card);
    emitEvent('card:turn_started', { card_id: card.id, project_id: card.project_id, turn_id: turnId });

    let success = false;
    try {
        let result;
        let attempt = 0;
        while (true) {
            attempt++;
            try {
                result = await runClaude(userMessage, {
                    cwd: card.worktree_path,
                    systemPrompt,
                    model: model || undefined,
                    continueSession: true,
                    abortSignal: ac.signal,
                }, (e: ClaudeEvent) => {
                    handleEvent(card, conversationId, turnId, e);
                });
                break;
            } catch (err) {
                if (ac.signal.aborted) throw err;
                const { isRateLimit, retryAfterMs } = classifyRateLimit(err);
                if (!isRateLimit || attempt >= MAX_RETRY_ATTEMPTS) throw err;
                const backoff = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempt - 1));
                const delayMs = (retryAfterMs ?? backoff) + Math.floor(Math.random() * 1000);
                emitEvent('card:rate_limited', {
                    card_id: card.id,
                    project_id: card.project_id,
                    turn_id: turnId,
                    attempt,
                    max_attempts: MAX_RETRY_ATTEMPTS,
                    delay_ms: delayMs,
                });
                await sleepWithAbort(delayMs, ac.signal);
            }
        }

        if (result.finalText) {
            const finalRow = appendMessage({
                conversation_id: conversationId,
                turn_id: turnId,
                role: 'assistant',
                content_text: result.finalText,
                streaming_complete: true,
            });
            emitEvent('card:message', {
                card_id: card.id,
                project_id: card.project_id,
                message: finalRow,
            });
        }
        emitEvent('card:turn_complete', {
            card_id: card.id,
            project_id: card.project_id,
            turn_id: turnId,
            session_id: result.sessionId,
            usage: result.usage,
            duration_ms: result.durationMs,
        });
        success = true;
    } finally {
        if (cardAborts.get(card.id) === ac) cardAborts.delete(card.id);
        recordTurnEnd(turnId, success ? 'complete' : 'failed');
    }
}

function handleEvent(card: Card, conversationId: string, turnId: string, e: ClaudeEvent): void {
    if (e.kind === 'tool_use') {
        const row = appendMessage({
            conversation_id: conversationId,
            turn_id: turnId,
            role: 'tool_use',
            tool_name: e.name,
            content_json: { tool_use_id: e.tool_use_id, name: e.name, input: e.input },
            streaming_complete: true,
        });
        emitEvent('card:message', { card_id: card.id, project_id: card.project_id, message: row });
    } else if (e.kind === 'tool_result') {
        const row = appendMessage({
            conversation_id: conversationId,
            turn_id: turnId,
            role: 'tool_result',
            content_json: { tool_use_id: e.tool_use_id, content: e.content, is_error: e.is_error },
            streaming_complete: true,
        });
        emitEvent('card:message', { card_id: card.id, project_id: card.project_id, message: row });
    } else if (e.kind === 'text') {
        emitEvent('card:text_stream', { card_id: card.id, project_id: card.project_id, turn_id: turnId, text: e.text });
    } else if (e.kind === 'usage') {
        emitEvent('card:usage', {
            card_id: card.id,
            project_id: card.project_id,
            turn_id: turnId,
            input_tokens: e.input_tokens,
            output_tokens: e.output_tokens,
            cache_read_tokens: e.cache_read_tokens,
            cache_creation_tokens: e.cache_creation_tokens,
        });
    } else if (e.kind === 'error') {
        emitEvent('card:error', { card_id: card.id, project_id: card.project_id, turn_id: turnId, message: e.message });
    }
}
