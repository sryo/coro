import { redirect } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Project } from '@coro/types';
import { ProjectsIndex } from '@/components/projects-index';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
    const projects = await serverGet<Project[]>('/projects?include=counts');
    const { all } = await searchParams;

    if (!projects) {
        return (
            <main className="mx-auto max-w-2xl px-8 py-24">
                <h1 className="text-4xl font-bold tracking-tight">Coro</h1>
                <p className="mt-6 text-[var(--muted-foreground)]">
                    Daemon isn&apos;t running. Start it with <code className="font-mono text-[var(--foreground)]">coro daemon start</code>.
                </p>
            </main>
        );
    }

    if (projects.length === 1 && all !== '1') redirect(`/p/${projects[0].id}`);

    return (
        <main className="mx-auto max-w-2xl px-8 py-24">
            <h1 className="text-4xl font-bold tracking-tight">Coro</h1>
            {projects.length === 0 ? (
                <p className="mt-6 text-[var(--muted-foreground)]">
                    No projects yet. Run <code className="font-mono text-[var(--foreground)]">/coro-new &quot;&lt;title&gt;&quot;</code> in a git repo to bind it.
                </p>
            ) : (
                <ProjectsIndex projects={projects} />
            )}
        </main>
    );
}
