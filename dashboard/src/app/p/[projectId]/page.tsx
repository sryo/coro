import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Project, Stage, Card } from '@coro/types';
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
        <main className="flex h-screen flex-col overflow-hidden">
            <Board project={project} initialStages={stages || []} initialCards={cards || []} />
        </main>
    );
}
