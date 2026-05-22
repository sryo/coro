import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Card, Project, Stage, WorktreeStatus } from '@coro/types';
import { Conversation } from '@/components/conversation';
import { CardDetailHeader } from '@/components/card-detail-header';
import { CardActions } from '@/components/card-actions';

export default async function CardPage({ params }: { params: Promise<{ projectId: string; cardId: string }> }) {
    const { projectId, cardId } = await params;

    const [project, card, stages] = await Promise.all([
        serverGet<Project>(`/projects/${projectId}`),
        serverGet<Card>(`/cards/${cardId}`),
        serverGet<Stage[]>(`/projects/${projectId}/stages`),
    ]);

    if (!project || !card || !stages) notFound();

    // worktree may not exist if card hasn't entered active yet
    const worktree = card.worktree_path ? await serverGet<WorktreeStatus>(`/cards/${cardId}/worktree`) : null;

    return (
        <main className="grid h-screen grid-cols-[360px_1fr]">
            <aside className="border-r border-[var(--border)] overflow-y-auto">
                <div className="px-6 py-6">
                    <Link href={`/p/${projectId}`} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                        ← {project.name}
                    </Link>
                </div>
                <CardDetailHeader card={card} worktree={worktree} />
                <div className="px-6 pb-8">
                    <CardActions card={card} stages={stages} />
                </div>
            </aside>
            <section className="overflow-hidden">
                <Conversation card={card} />
            </section>
        </main>
    );
}
