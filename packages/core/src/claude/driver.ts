import { runCommandStreaming } from './subprocess';
import type { ClaudeEvent, ClaudeRunOptions, ClaudeRunResult } from './types';

/**
 * Invoke the `claude` CLI in stream-json mode and dispatch parsed events.
 * Returns the final accumulated text plus session metadata.
 *
 * Each call is a single turn. Conversation continuation is handled by passing
 * `continueSession: true` (default), which adds `-c` so claude resumes the
 * most-recent session in `cwd`.
 */
export async function runClaude(
    prompt: string,
    opts: ClaudeRunOptions,
    onEvent: (e: ClaudeEvent) => void,
): Promise<ClaudeRunResult> {
    const args = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
    if (opts.continueSession !== false) args.push('-c');
    args.push('-p', prompt);

    let finalText = '';
    let sessionId: string | undefined;
    let usage: ClaudeRunResult['usage'];
    const start = Date.now();

    const { promise, signalDone } = runCommandStreaming('claude', args, (line) => {
        let json: any;
        try { json = JSON.parse(line); } catch { return; }
        for (const e of parseEvent(json)) {
            if (e.kind === 'text') finalText = e.text;
            if (e.kind === 'usage' && !usage) usage = { input_tokens: e.input_tokens, output_tokens: e.output_tokens };
            if (e.kind === 'system' && e.session_id) sessionId = e.session_id;
            try { onEvent(e); } catch { /* never let listener errors kill the turn */ }
        }
        if (json.type === 'result') {
            if (json.result && !finalText) finalText = json.result;
            if (json.usage && !usage) {
                usage = {
                    input_tokens: json.usage.input_tokens || 0,
                    output_tokens: json.usage.output_tokens || 0,
                };
            }
            signalDone();
        }
    }, {
        cwd: opts.cwd,
        env: opts.env,
        abortSignal: opts.abortSignal,
    });

    try {
        await promise;
    } catch (err: any) {
        try { onEvent({ kind: 'error', message: err.message || String(err) }); } catch {}
        throw err;
    }

    return {
        finalText,
        sessionId,
        usage,
        durationMs: Date.now() - start,
    };
}

function parseEvent(json: any): ClaudeEvent[] {
    if (json.type === 'system') {
        return [{ kind: 'system', subtype: json.subtype || '', session_id: json.session_id }];
    }
    if (json.type === 'assistant' && json.message?.content) {
        const events: ClaudeEvent[] = [];
        let textParts: string[] = [];
        for (const block of json.message.content) {
            if (block.type === 'text' && block.text) {
                textParts.push(block.text);
            } else if (block.type === 'tool_use') {
                if (textParts.length > 0) {
                    events.push({ kind: 'text', text: textParts.join('') });
                    textParts = [];
                }
                events.push({
                    kind: 'tool_use',
                    tool_use_id: block.id,
                    name: block.name,
                    input: block.input,
                });
            }
        }
        if (textParts.length > 0) events.push({ kind: 'text', text: textParts.join('') });
        if (json.message.usage) {
            events.push({
                kind: 'usage',
                input_tokens: json.message.usage.input_tokens || 0,
                output_tokens: json.message.usage.output_tokens || 0,
                cache_read_tokens: json.message.usage.cache_read_input_tokens,
                cache_creation_tokens: json.message.usage.cache_creation_input_tokens,
            });
        }
        return events;
    }
    if (json.type === 'user' && json.message?.content) {
        const events: ClaudeEvent[] = [];
        for (const block of json.message.content) {
            if (block.type === 'tool_result') {
                events.push({
                    kind: 'tool_result',
                    tool_use_id: block.tool_use_id,
                    content: block.content,
                    is_error: !!block.is_error,
                });
            }
        }
        return events;
    }
    return [];
}
