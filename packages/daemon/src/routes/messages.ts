import http from 'http';
import { Hono } from 'hono';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { conversations, cards, projects } from '@concerto/core';
import { attachSSEStream } from '../sse';
import { httpError, errorStatus, parseJsonBody } from './_helpers';
import { sendMessageBody } from './schemas';

const router = new Hono();

router.post('/cards/:id/messages', async (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');

    const parsed = await parseJsonBody(c, sendMessageBody);
    if (!parsed.ok) return httpError(c, 400, 'bad_request', parsed.message);
    const body = parsed.data;

    try {
        const result = conversations.sendMessage(card.id, body.content, { clientMessageId: body.client_message_id });
        return c.json(result, 202);
    } catch (err: any) {
        const code = err.code || 'send_failed';
        return httpError(c, errorStatus(code) as 400 | 404 | 409, code, err.message, {
            hint: err.hint,
        });
    }
});

router.get('/cards/:id/messages', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    const sinceId = parseInt(c.req.query('since_id') || '0', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 1000);
    return c.json(conversations.listMessages(card.id, sinceId, limit));
});

router.get('/projects/:id/stream', (c) => {
    const project = projects.getProject(c.req.param('id'));
    if (!project) return httpError(c, 404, 'not_found', 'project not found');
    const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
    attachSSEStream(nodeRes, { projectId: project.id });
    return RESPONSE_ALREADY_SENT;
});

router.get('/cards/:id/stream', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
    attachSSEStream(nodeRes, { cardId: card.id });
    return RESPONSE_ALREADY_SENT;
});

router.post('/cards/:id/interrupt', (c) => {
    const card = cards.getCard(c.req.param('id'));
    if (!card) return httpError(c, 404, 'not_found', 'card not found');
    const aborted = conversations.abortTurn(card.id);
    return c.json({ aborted });
});

export default router;
