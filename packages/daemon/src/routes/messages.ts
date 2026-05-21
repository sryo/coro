import http from 'http';
import { Hono } from 'hono';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { conversations, cards } from '@concerto/core';
import { addSSEClient, removeSSEClient } from '../sse';

const router = new Hono();

router.post('/cards/:id/messages', async (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);

    const body = await c.req.json().catch(() => null) as { content?: string; client_message_id?: string } | null;
    if (!body?.content || body.content.trim().length === 0) {
        return c.json({ error: { code: 'bad_request', message: 'content required' } }, 400);
    }

    try {
        const result = conversations.sendMessage(card.id, body.content, { clientMessageId: body.client_message_id });
        return c.json(result, 202);
    } catch (err: any) {
        return c.json({
            error: {
                code: err.code || 'send_failed',
                message: err.message,
                hint: err.hint,
            },
        }, err.code === 'card_not_active' ? 409 : 400);
    }
});

router.get('/cards/:id/messages', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 1000);
    return c.json(conversations.listMessages(card.id, sinceId, limit));
});

router.get('/cards/:id/stream', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);

    const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
    nodeRes.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    nodeRes.write(`event: connected\ndata: ${JSON.stringify({ card_id: card.id, timestamp: Date.now() })}\n\n`);
    addSSEClient(nodeRes, { cardId: card.id });
    nodeRes.on('close', () => removeSSEClient(nodeRes));

    return RESPONSE_ALREADY_SENT;
});

router.post('/cards/:id/interrupt', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return c.json({ error: { code: 'not_found', message: 'card not found' } }, 404);
    const aborted = conversations.abortTurn(card.id);
    return c.json({ aborted });
});

export default router;
