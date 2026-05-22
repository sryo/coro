'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface UseInlineEditOptions {
    value: string;
    onSubmit: (next: string) => Promise<void> | void;
    allowEmpty?: boolean;
    onCancel?: () => void;
    autoEdit?: boolean;
}

function useInlineEdit({ value, onSubmit, allowEmpty, onCancel, autoEdit }: UseInlineEditOptions) {
    const [editing, setEditing] = useState(!!autoEdit);
    const [draft, setDraft] = useState(value);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    function cancel() {
        setDraft(value);
        setEditing(false);
        onCancel?.();
    }

    async function commit() {
        const trimmed = draft.trim();
        if (!allowEmpty && trimmed === '') { cancel(); return; }
        if (trimmed === value) {
            // No-change dismissal — the session is over, parent needs to know.
            setEditing(false);
            onCancel?.();
            return;
        }
        setBusy(true);
        try {
            await onSubmit(trimmed);
            setEditing(false);
        } catch {
            setDraft(value);
            setEditing(false);
        } finally {
            setBusy(false);
        }
    }

    return { editing, draft, busy, beginEdit: () => setEditing(true), cancel, commit, setDraft };
}

interface InlineTextProps extends UseInlineEditOptions {
    placeholder?: string;
    className?: string;
    as?: 'span' | 'div';
}

export function InlineText({ value, placeholder, className, as = 'span', ...opts }: InlineTextProps) {
    const { editing, draft, busy, beginEdit, cancel, commit, setDraft } = useInlineEdit({ value, ...opts });
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const Wrapper = as;
    const isEmpty = !value;

    if (!editing) {
        return (
            <Wrapper
                onClick={beginEdit}
                className={cn(
                    'cursor-text rounded-sm -mx-1 px-1 hover:bg-[var(--muted)] transition-colors',
                    isEmpty && 'text-[var(--muted-foreground)]',
                    className,
                )}
            >
                {isEmpty ? (placeholder ?? ' ') : value}
            </Wrapper>
        );
    }

    return (
        <input
            ref={inputRef}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            placeholder={placeholder}
            className={cn('bg-[var(--muted)] -mx-1 px-1 rounded-sm focus:outline-none', className)}
        />
    );
}

interface InlineTextareaProps extends UseInlineEditOptions {
    placeholder?: string;
    className?: string;
    rows?: number;
}

export function InlineTextarea({ value, placeholder, className, rows = 3, ...opts }: InlineTextareaProps) {
    const { editing, draft, busy, beginEdit, cancel, commit, setDraft } = useInlineEdit({ value, ...opts });
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing && ref.current) ref.current.focus();
    }, [editing]);

    const isEmpty = !value;

    if (!editing) {
        return (
            <div
                onClick={beginEdit}
                className={cn(
                    'cursor-text rounded-sm -mx-1 px-1 hover:bg-[var(--muted)] transition-colors whitespace-pre-wrap',
                    isEmpty && 'text-[var(--muted-foreground)]',
                    className,
                )}
            >
                {isEmpty ? (placeholder ?? ' ') : value}
            </div>
        );
    }

    return (
        <textarea
            ref={ref}
            value={draft}
            rows={rows}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            placeholder={placeholder}
            className={cn(
                'w-full resize-none bg-[var(--muted)] -mx-1 px-1 rounded-sm focus:outline-none',
                className,
            )}
        />
    );
}
