// Spawn a CLI subprocess and stream stdout line-by-line.
// Lifted from fonte's invoke.ts:runCommandStreaming, with the global activeProcesses
// Map replaced by an AbortSignal plumbed through opts.

import { spawn } from 'child_process';

export interface StreamingOpts {
    cwd?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
}

/**
 * Spawn a command, deliver each stdout line to onLine, return both a promise of full stdout
 * and a signalDone() the caller can use when they're sure no more useful output is coming.
 * After signalDone, the process gets 30s to exit cleanly, then it's killed.
 */
export function runCommandStreaming(
    command: string,
    args: string[],
    onLine: (line: string) => void,
    opts: StreamingOpts = {},
): { promise: Promise<string>; signalDone: () => void } {
    let signalDoneCallback: (() => void) | null = null;

    const promise = new Promise<string>((resolve, reject) => {
        const env = { ...process.env, ...(opts.env || {}) };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: opts.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';
        let lineBuffer = '';
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | null = null;

        const onAbort = () => {
            if (settled) return;
            try { child.kill('SIGTERM'); } catch {}
        };
        if (opts.abortSignal) {
            if (opts.abortSignal.aborted) onAbort();
            else opts.abortSignal.addEventListener('abort', onAbort);
        }

        function settle(code: number | null) {
            if (settled) return;
            settled = true;
            if (graceTimer) clearTimeout(graceTimer);
            if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
            if (lineBuffer.trim()) onLine(lineBuffer);
            if (code === 0 || code === null) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
            }
        }

        signalDoneCallback = () => {
            if (settled) return;
            graceTimer = setTimeout(() => {
                if (!settled) {
                    settle(0);
                    try { child.kill('SIGTERM'); } catch {}
                }
            }, 30_000);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            lineBuffer += chunk;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop()!;
            for (const line of lines) {
                if (line.trim()) onLine(line);
            }
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            if (graceTimer) clearTimeout(graceTimer);
            if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
            reject(err);
        });

        child.on('close', (code) => settle(code));
    });

    return { promise, signalDone: () => signalDoneCallback?.() };
}
