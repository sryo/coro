import http from 'http';
import { onEvent } from '@concerto/core';

interface Client {
    res: http.ServerResponse;
    cardId?: string;       // if set, only events with matching card_id are delivered
    projectId?: string;    // if set, only events with matching project_id are delivered
}

const clients = new Set<Client>();

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
    const greeting = scope.cardId
        ? { card_id: scope.cardId, timestamp: Date.now() }
        : { project_id: scope.projectId, timestamp: Date.now() };
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
