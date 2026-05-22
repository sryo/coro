import http from 'http';
import { onEvent, conversations } from '@coro/core';

interface Client {
    res: http.ServerResponse;
    cardId?: string;       // if set, only events with matching card_id are delivered
    projectId?: string;    // if set, only events with matching project_id are delivered
}

const clients = new Set<Client>();

// Heartbeat keeps the client's watchdog from triggering an unnecessary reconnect
// on idle projects. The dashboard's EventSource wrapper expects something on the
// wire at least every 60s.
const HEARTBEAT_MS = 20_000;
const heartbeatTimer = setInterval(() => {
    if (clients.size === 0) return;
    const payload = `event: heartbeat\ndata: {}\n\n`;
    for (const client of clients) {
        try { client.res.write(payload); } catch { clients.delete(client); }
    }
}, HEARTBEAT_MS);
heartbeatTimer.unref?.();

export function addSSEClient(res: http.ServerResponse, opts: { cardId?: string; projectId?: string } = {}): void {
    clients.add({ res, cardId: opts.cardId, projectId: opts.projectId });
}

export function removeSSEClient(res: http.ServerResponse): void {
    for (const client of clients) {
        if (client.res === res) clients.delete(client);
    }
}

export function attachSSEStream(
    res: http.ServerResponse,
    scope: { cardId?: string; projectId?: string },
): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    const streamingCardIds = scope.cardId
        ? (conversations.getStreamingCardIds().includes(scope.cardId) ? [scope.cardId] : [])
        : conversations.getStreamingCardIds(scope.projectId);
    const greeting = scope.cardId
        ? { card_id: scope.cardId, timestamp: Date.now(), streaming_card_ids: streamingCardIds }
        : { project_id: scope.projectId, timestamp: Date.now(), streaming_card_ids: streamingCardIds };
    res.write(`event: connected\ndata: ${JSON.stringify(greeting)}\n\n`);
    addSSEClient(res, scope);
    res.on('close', () => removeSSEClient(res));
}

function broadcast(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify({ type: event, timestamp: Date.now(), ...data })}\n\n`;
    for (const client of clients) {
        if (client.cardId && data.card_id !== client.cardId) continue;
        if (client.projectId && data.project_id !== client.projectId) continue;
        try { client.res.write(payload); } catch { clients.delete(client); }
    }
}

// Wire core events → SSE
onEvent((type, data) => broadcast(type, data));
