export type ClaudeEvent =
    | { kind: 'text'; text: string }
    | { kind: 'tool_use'; tool_use_id: string; name: string; input: unknown }
    | { kind: 'tool_result'; tool_use_id: string; content: unknown; is_error: boolean }
    | { kind: 'usage'; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number }
    | { kind: 'system'; subtype: string; session_id?: string }
    | { kind: 'error'; message: string };

export interface ClaudeRunOptions {
    cwd: string;
    systemPrompt?: string;
    model?: string;
    continueSession?: boolean;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
}

export interface ClaudeRunResult {
    finalText: string;
    sessionId?: string;
    usage?: { input_tokens: number; output_tokens: number };
    durationMs: number;
}
