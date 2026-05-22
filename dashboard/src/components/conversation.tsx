'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, openStream } from '@/lib/api';
import type { Card, Message } from '@coro/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
    card: Card;
}

export function Conversation({ card }: Props) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [streamingText, setStreamingText] = useState<string>('');
    const scrollerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        api.get<Message[]>(`/cards/${card.id}/messages`).then((m) => {
            if (!cancelled) setMessages(m);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [card.id]);

    useEffect(() => {
        if (!card.worktree_path) return;
        const es = openStream(card.id, (type, data) => {
            if (type === 'card:message') {
                const msg = data.message as Message;
                setMessages((prev) => {
                    if (prev.some((m) => m.id === msg.id)) return prev;
                    return [...prev, msg];
                });
                if (msg.role === 'assistant') setStreamingText('');
            } else if (type === 'card:text_stream') {
                setStreamingText(data.text || '');
            } else if (type === 'card:turn_complete') {
                setStreamingText('');
            } else if (type === 'card:error' || type === 'card:turn_failed') {
                setStreamingText('');
            }
        });
        return () => es.close();
    }, [card.id, card.worktree_path]);

    useEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, streamingText]);

    async function send() {
        if (!draft.trim() || busy) return;
        setBusy(true);
        const content = draft.trim();
        setDraft('');
        try {
            await api.post(`/cards/${card.id}/messages`, { content });
        } catch (err: any) {
            // surface as a fake system message
            setMessages((prev) => [...prev, {
                id: -Date.now(),
                conversation_id: '',
                message_id: `err-${Date.now()}`,
                turn_id: '',
                role: 'system',
                content_text: err.message,
                content_json: null,
                tool_name: null,
                streaming_complete: 1,
                created_at: Date.now(),
            }]);
        } finally {
            setBusy(false);
        }
    }

    if (!card.worktree_path) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
                Move this card to In Progress to start a conversation.
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div ref={scrollerRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
                {messages.length === 0 && !streamingText && (
                    <p className="text-sm text-[var(--muted-foreground)]">No messages yet. Say hello.</p>
                )}
                {messages.map((m) => <MessageRow key={m.id} message={m} />)}
                {streamingText && (
                    <div className="text-sm">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">assistant</div>
                        <div className="whitespace-pre-wrap leading-relaxed">{streamingText}</div>
                    </div>
                )}
            </div>
            <div className="border-t border-[var(--border)] p-4">
                <Textarea
                    rows={3}
                    placeholder="Message the agent…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    disabled={busy}
                />
                <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-[var(--muted-foreground)]">⌘↵ to send</span>
                    <Button size="sm" onClick={send} disabled={busy || !draft.trim()}>
                        Send
                    </Button>
                </div>
            </div>
        </div>
    );
}

function MessageRow({ message }: { message: Message }) {
    if (message.role === 'tool_use') {
        const data = message.content_json ? JSON.parse(message.content_json) : null;
        return (
            <div className="text-sm">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    tool · {message.tool_name}
                </div>
                <pre className="font-mono text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">
                    {data?.input ? JSON.stringify(data.input, null, 2) : ''}
                </pre>
            </div>
        );
    }
    if (message.role === 'tool_result') {
        const data = message.content_json ? JSON.parse(message.content_json) : null;
        return (
            <div className="text-sm">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    result {data?.is_error ? '(error)' : ''}
                </div>
                <pre className="font-mono text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">
                    {typeof data?.content === 'string' ? data.content : JSON.stringify(data?.content, null, 2)}
                </pre>
            </div>
        );
    }
    const label = message.role === 'user' ? 'you' : message.role;
    return (
        <div className="text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
            <div className="prose prose-sm max-w-none leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content_text || ''}</ReactMarkdown>
            </div>
        </div>
    );
}
