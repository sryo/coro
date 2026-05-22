#!/usr/bin/env node
// MCP server (stdio JSON-RPC) for a single concerto card.
//
// Spawned by `claude` via the worktree's .mcp.json. Each tool call is proxied to
// the daemon over HTTP. Auth + card identity come from env vars baked into the
// .mcp.json at worktree-creation time:
//   CONCERTO_CARD_ID    — card this MCP server is bound to
//   CONCERTO_DAEMON_URL — e.g. http://localhost:7419
//   CONCERTO_DAEMON_TOKEN
//
// MCP protocol: JSON-RPC 2.0 over stdio, newline-delimited. We implement just
// enough — `initialize`, `tools/list`, `tools/call`. Notifications are ignored.

import readline from 'node:readline';

const CARD_ID = process.env.CONCERTO_CARD_ID;
const DAEMON_URL = process.env.CONCERTO_DAEMON_URL;
const TOKEN = process.env.CONCERTO_DAEMON_TOKEN;

if (!CARD_ID || !DAEMON_URL || !TOKEN) {
    process.stderr.write('concerto-mcp: missing CONCERTO_CARD_ID / CONCERTO_DAEMON_URL / CONCERTO_DAEMON_TOKEN\n');
    process.exit(2);
}

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

async function api(method, path, body) {
    const res = await fetch(DAEMON_URL + path, {
        method,
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) {
        const err = new Error((json && json.error && json.error.message) || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json;
}

const TOOLS = [
    {
        name: 'concerto.get_card',
        description: 'Get this card\'s metadata: title, description, current stage, branch, worktree, timestamps. Call at the start of a conversation to refresh your view.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'concerto.list_stages',
        description: 'List all stages in this card\'s project in order, with their kinds (backlog/ready/active/review/done/archive). Use to find a valid target before calling concerto.set_status.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'concerto.set_status',
        description: 'Move this card to a different stage. Use \'Testing\' when ready for the user to verify; use \'Review\' when confident the work is done. Cannot move to \'Done\' or \'Merged\' — those require human approval. Pass `to_stage` as the stage name from concerto.list_stages.',
        inputSchema: {
            type: 'object',
            required: ['to_stage'],
            properties: {
                to_stage: { type: 'string', description: 'Stage name, e.g. "Testing".' },
                reason: { type: 'string', description: 'One-line reason for the user.' },
            },
        },
    },
    {
        name: 'concerto.add_note',
        description: 'Append a note to this card\'s activity log. The user sees these in the dashboard. Use for status updates, decisions, or anything they should know at a glance.',
        inputSchema: {
            type: 'object',
            required: ['content'],
            properties: {
                content: { type: 'string', description: 'Note body (markdown ok).' },
            },
        },
    },
    {
        name: 'concerto.request_review',
        description: 'Mark this card as ready for human review. Equivalent to set_status({to_stage: \'Review\'}) and pings the user via the dashboard. Call this when you believe the work is done and want a human to approve and merge.',
        inputSchema: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Short summary of what was done.' },
            },
        },
    },
];

function textContent(s) {
    return { content: [{ type: 'text', text: s }] };
}

function errorContent(s) {
    return { content: [{ type: 'text', text: s }], isError: true };
}

async function findStageIdByName(projectId, name) {
    const stages = await api('GET', `/projects/${projectId}/stages`);
    const target = stages.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (target) return { stageId: target.id, stages };
    return { stageId: null, stages };
}

async function callTool(name, args) {
    switch (name) {
        case 'concerto.get_card': {
            const card = await api('GET', `/cards/${CARD_ID}`);
            return textContent(JSON.stringify(card, null, 2));
        }
        case 'concerto.list_stages': {
            const card = await api('GET', `/cards/${CARD_ID}`);
            const stages = await api('GET', `/projects/${card.project_id}/stages`);
            return textContent(JSON.stringify(stages.map(s => ({ name: s.name, kind: s.kind, position: s.position })), null, 2));
        }
        case 'concerto.set_status': {
            const target = String(args?.to_stage || '').trim();
            if (!target) return errorContent('to_stage is required');
            const card = await api('GET', `/cards/${CARD_ID}`);
            const { stageId, stages } = await findStageIdByName(card.project_id, target);
            if (!stageId) {
                return errorContent(`stage "${target}" not found. Available: ${stages.map(s => s.name).join(', ')}`);
            }
            try {
                const updated = await api('POST', `/cards/${CARD_ID}/transitions`, {
                    to_stage_id: stageId,
                    actor: 'agent',
                    reason: args?.reason,
                });
                return textContent(`moved to "${target}". new stage_id=${updated.stage_id}`);
            } catch (err) {
                const allowed = err.body?.error?.allowed;
                if (Array.isArray(allowed) && allowed.length > 0) {
                    const allowedNames = stages.filter(s => allowed.includes(s.id)).map(s => s.name);
                    return errorContent(`${err.message}. Allowed targets: ${allowedNames.join(', ')}`);
                }
                return errorContent(err.message);
            }
        }
        case 'concerto.add_note': {
            const content = String(args?.content || '').trim();
            if (!content) return errorContent('content is required');
            await api('POST', `/cards/${CARD_ID}/notes`, { content });
            return textContent('note added');
        }
        case 'concerto.request_review': {
            const card = await api('GET', `/cards/${CARD_ID}`);
            const { stageId, stages } = await findStageIdByName(card.project_id, 'Review');
            const reviewStage = stageId
                ? { id: stageId, name: 'Review' }
                : stages.find(s => s.kind === 'review');
            if (!reviewStage) return errorContent('no review-kind stage in this project');
            const reason = args?.summary ? `request_review: ${args.summary}` : 'request_review';
            try {
                await api('POST', `/cards/${CARD_ID}/transitions`, {
                    to_stage_id: reviewStage.id,
                    actor: 'agent',
                    reason,
                });
                if (args?.summary) {
                    await api('POST', `/cards/${CARD_ID}/notes`, {
                        content: `**Summary:** ${args.summary}`,
                    });
                }
                return textContent('card moved to Review. waiting on human approval.');
            } catch (err) {
                return errorContent(err.message);
            }
        }
        default:
            return errorContent(`unknown tool: ${name}`);
    }
}

async function handle(msg) {
    if (msg.method === 'initialize') {
        send({
            jsonrpc: '2.0', id: msg.id,
            result: {
                protocolVersion: msg.params?.protocolVersion || '2024-11-05',
                serverInfo: { name: 'concerto', version: '0.0.0' },
                capabilities: { tools: {} },
            },
        });
        return;
    }
    if (msg.method === 'notifications/initialized' || msg.method === 'initialized') {
        return; // notification, no response
    }
    if (msg.method === 'tools/list') {
        send({
            jsonrpc: '2.0', id: msg.id,
            result: { tools: TOOLS },
        });
        return;
    }
    if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        try {
            const result = await callTool(name, args);
            send({ jsonrpc: '2.0', id: msg.id, result });
        } catch (err) {
            send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message } });
        }
        return;
    }
    if (msg.method === 'ping') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
        return;
    }
    if (msg.id !== undefined) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
    }
}

const inFlight = new Set();
let inputClosed = false;

function maybeExit() {
    if (inputClosed && inFlight.size === 0) process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
        process.stderr.write(`concerto-mcp: bad json: ${line}\n`);
        return;
    }
    const p = handle(msg).catch((err) => {
        process.stderr.write(`concerto-mcp: handler error: ${err.message}\n`);
    }).finally(() => {
        inFlight.delete(p);
        maybeExit();
    });
    inFlight.add(p);
});
rl.on('close', () => { inputClosed = true; maybeExit(); });
