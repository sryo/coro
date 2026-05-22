'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Project } from '@coro/types';
import { TimeAgo } from '@/components/time-ago';

interface Props {
    projects: Project[];
}

export function ProjectsIndex({ projects: initial }: Props) {
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>(initial);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const sorted = [...projects].sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));

    async function confirmDelete(id: string) {
        setError(null);
        try {
            await api.delete(`/projects/${id}`);
            setProjects((prev) => prev.filter((p) => p.id !== id));
            setPendingDelete(null);
            router.refresh();
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        }
    }

    return (
        <div className="mt-12 space-y-1">
            {error && (
                <p className="mb-4 text-xs text-[var(--muted-foreground)]">{error}</p>
            )}
            {sorted.map((p) => (
                <div key={p.id} className="group/row flex items-baseline gap-3 rounded-md px-3 py-3 hover:bg-[var(--muted)]">
                    <Link href={`/p/${p.id}`} className="flex-1 min-w-0 flex items-baseline gap-3">
                        <span className="text-lg font-semibold truncate">{p.name}</span>
                        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                            {p.card_count ?? 0}
                        </span>
                    </Link>
                    <div className="flex items-baseline gap-4 text-xs text-[var(--muted-foreground)]">
                        {p.last_activity_at && (
                            <span><TimeAgo ms={p.last_activity_at} /></span>
                        )}
                        <span className="font-mono truncate hidden sm:inline" title={p.repo_path}>{p.repo_path}</span>
                        {pendingDelete === p.id ? (
                            <span className="flex items-baseline gap-2">
                                <span>delete?</span>
                                <button
                                    onClick={() => confirmDelete(p.id)}
                                    className="font-semibold text-[var(--foreground)] hover:underline"
                                >
                                    remove
                                </button>
                                <button
                                    onClick={() => setPendingDelete(null)}
                                    className="hover:text-[var(--foreground)]"
                                >
                                    cancel
                                </button>
                            </span>
                        ) : (
                            <button
                                onClick={() => setPendingDelete(p.id)}
                                className="opacity-0 group-hover/row:opacity-100 hover:text-[var(--foreground)] transition-opacity"
                            >
                                delete
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
