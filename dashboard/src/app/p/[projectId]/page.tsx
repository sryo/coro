import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Project, Stage, Card } from '@concerto/types';
import { Board } from '@/components/board';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const project = await serverGet<Project>(`/projects/${projectId}`);
    if (!project) notFound();

    const [stages, cards] = await Promise.all([
        serverGet<Stage[]>(`/projects/${projectId}/stages`),
        serverGet<Card[]>(`/projects/${projectId}/cards`),
    ]);

    return (
        <main className="min-h-screen">
            <header className="border-b border-[var(--border)] px-8 py-6">
                <div className="flex items-baseline justify-between gap-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
                        <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">{project.repo_path}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href={`/p/${projectId}/settings`} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                            settings
                        </Link>
                        <Link href="/" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                            all projects
                        </Link>
                    </div>
                </div>
            </header>
            <Board projectId={projectId} stages={stages || []} initialCards={cards || []} />
        </main>
    );
}
