import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Project, Stage } from '@concerto/types';
import { StageEditor } from '@/components/stage-editor';
import { ProjectMetaEditor } from '@/components/project-meta-editor';

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const [project, stages] = await Promise.all([
        serverGet<Project>(`/projects/${projectId}`),
        serverGet<Stage[]>(`/projects/${projectId}/stages`),
    ]);
    if (!project || !stages) notFound();

    return (
        <main className="mx-auto max-w-3xl px-8 py-12">
            <header className="mb-10">
                <Link href={`/p/${projectId}`} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    ← {project.name}
                </Link>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">Settings</h1>
            </header>

            <section className="mb-12">
                <h2 className="text-sm font-semibold uppercase tracking-wide mb-4">Project</h2>
                <ProjectMetaEditor project={project} />
            </section>

            <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide mb-1">Stages</h2>
                <p className="text-xs text-[var(--muted-foreground)] mb-6">
                    Drag to reorder. At least one of each: <code className="font-mono">backlog</code>, <code className="font-mono">active</code>, <code className="font-mono">review</code>, <code className="font-mono">archive</code>.
                    Stages can only be replaced when the project has no cards yet (v0).
                </p>
                <StageEditor projectId={projectId} initialStages={stages} />
            </section>
        </main>
    );
}
