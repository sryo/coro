import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet, serverGetText } from '@/lib/server-api';
import type { Card, Project } from '@coro/types';

export default async function DiffPage({
    params,
    searchParams,
}: {
    params: Promise<{ projectId: string; cardId: string }>;
    searchParams: Promise<{ against?: string }>;
}) {
    const { projectId, cardId } = await params;
    const { against } = await searchParams;
    const target = against === 'head' ? 'head' : 'base';

    const [project, card] = await Promise.all([
        serverGet<Project>(`/projects/${projectId}`),
        serverGet<Card>(`/cards/${cardId}`),
    ]);
    if (!project || !card) notFound();

    const diff = card.worktree_path ? await serverGetText(`/cards/${cardId}/diff?against=${target}`) : '';

    return (
        <main className="min-h-screen">
            <header className="border-b border-[var(--border)] px-8 py-6">
                <div className="flex items-baseline justify-between">
                    <div>
                        <Link
                            href={`/p/${projectId}/c/${cardId}`}
                            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                            ← {card.title}
                        </Link>
                        <h1 className="mt-2 text-2xl font-bold tracking-tight">Diff</h1>
                        <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                            against {target} · {card.branch_name || '(no branch)'}
                        </p>
                    </div>
                    <div className="flex gap-3 text-xs">
                        <Link
                            href={`/p/${projectId}/c/${cardId}/diff?against=base`}
                            className={target === 'base' ? 'font-semibold' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}
                        >
                            vs base
                        </Link>
                        <Link
                            href={`/p/${projectId}/c/${cardId}/diff?against=head`}
                            className={target === 'head' ? 'font-semibold' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}
                        >
                            vs head
                        </Link>
                    </div>
                </div>
            </header>
            <section className="px-8 py-6">
                {!card.worktree_path ? (
                    <p className="text-sm text-[var(--muted-foreground)]">No worktree for this card yet.</p>
                ) : diff === null ? (
                    <p className="text-sm text-[var(--muted-foreground)]">Failed to load diff.</p>
                ) : diff.length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)]">No changes.</p>
                ) : (
                    <DiffView text={diff} />
                )}
            </section>
        </main>
    );
}

function DiffView({ text }: { text: string }) {
    const lines = text.split('\n');
    return (
        <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-4 font-mono text-xs leading-relaxed">
            <code>
                {lines.map((line, i) => (
                    <span key={i} className={lineClass(line)}>
                        {line || ' '}
                        {'\n'}
                    </span>
                ))}
            </code>
        </pre>
    );
}

function lineClass(line: string): string {
    if (line.startsWith('diff --git') || line.startsWith('index ')) return 'block text-[var(--muted-foreground)]';
    if (line.startsWith('---') || line.startsWith('+++')) return 'block font-semibold';
    if (line.startsWith('@@')) return 'block text-[var(--muted-foreground)]';
    if (line.startsWith('+')) return 'block bg-green-500/10 text-green-700 dark:text-green-300';
    if (line.startsWith('-')) return 'block bg-red-500/10 text-red-700 dark:text-red-300';
    return 'block';
}
