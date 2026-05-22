'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Project } from '@coro/types';
import { TimeAgo } from '@/components/time-ago';

interface Props {
    currentId: string;
}

export function ProjectSwitcher({ currentId }: Props) {
    const [open, setOpen] = useState(false);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open || projects) return;
        api.get<Project[]>('/projects?include=counts')
            .then(setProjects)
            .catch(() => setProjects([]));
    }, [open, projects]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const sorted = projects
        ? [...projects].sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0))
        : null;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
                switch
            </button>
            {open && (
                <div className="absolute right-0 top-full z-20 mt-2 min-w-[300px] rounded-md border border-[var(--border)] bg-[var(--background)] shadow-md">
                    {sorted === null ? (
                        <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">Loading…</p>
                    ) : sorted.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No projects.</p>
                    ) : (
                        <ul className="py-1 max-h-[60vh] overflow-y-auto">
                            {sorted.map((p) => (
                                <li key={p.id}>
                                    <Link
                                        href={`/p/${p.id}`}
                                        onClick={() => setOpen(false)}
                                        className={`block px-3 py-2 text-sm hover:bg-[var(--muted)] ${p.id === currentId ? 'font-semibold' : ''}`}
                                    >
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="truncate">{p.name}</span>
                                            <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                                                {p.card_count ?? 0}
                                            </span>
                                        </div>
                                        {p.last_activity_at && (
                                            <p className="text-xs text-[var(--muted-foreground)]">
                                                <TimeAgo ms={p.last_activity_at} />
                                            </p>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="border-t border-[var(--border)]">
                        <Link
                            href="/?all=1"
                            onClick={() => setOpen(false)}
                            className="block px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                        >
                            all projects →
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
