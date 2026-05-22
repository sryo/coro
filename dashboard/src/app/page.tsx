import { redirect } from 'next/navigation';
import Link from 'next/link';
import { serverGet } from '@/lib/server-api';
import type { Project } from '@concerto/types';

export default async function HomePage() {
    const projects = await serverGet<Project[]>('/projects');

    if (!projects) {
        return (
            <main className="mx-auto max-w-2xl px-8 py-24">
                <h1 className="text-4xl font-bold tracking-tight">Concerto</h1>
                <p className="mt-6 text-[var(--muted-foreground)]">
                    Daemon isn’t running. Start it with <code className="font-mono text-[var(--foreground)]">concerto daemon start</code>.
                </p>
            </main>
        );
    }

    if (projects.length === 1) redirect(`/p/${projects[0].id}`);

    return (
        <main className="mx-auto max-w-2xl px-8 py-24">
            <h1 className="text-4xl font-bold tracking-tight">Concerto</h1>
            {projects.length === 0 ? (
                <p className="mt-6 text-[var(--muted-foreground)]">
                    No projects yet. Run <code className="font-mono text-[var(--foreground)]">/concerto new &quot;&lt;title&gt;&quot;</code> in a git repo to bind it.
                </p>
            ) : (
                <ul className="mt-12 space-y-1">
                    {projects.map((p) => (
                        <li key={p.id}>
                            <Link
                                href={`/p/${p.id}`}
                                className="flex items-baseline justify-between rounded-md px-3 py-3 hover:bg-[var(--muted)]"
                            >
                                <span className="text-lg font-semibold">{p.name}</span>
                                <span className="font-mono text-xs text-[var(--muted-foreground)]">{p.repo_path}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
