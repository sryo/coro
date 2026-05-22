'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Project } from '@coro/types';
import { InlineText } from '@/components/inline-edit';

interface Props {
    project: Project;
}

export function BoardHeader({ project }: Props) {
    const router = useRouter();

    async function patch(body: Partial<Pick<Project, 'name' | 'base_branch'>>) {
        await api.patch<Project>(`/projects/${project.id}`, body);
        router.refresh();
    }

    return (
        <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-6 px-8 pt-6 pb-8">
            <div
                className="min-w-0 flex items-baseline justify-end font-mono text-xs text-[var(--muted-foreground)]"
                title={project.repo_path}
            >
                {project.repo_path.split('/').filter(Boolean).map((seg, i) => (
                    <span key={i} className="flex min-w-0 items-baseline">
                        <span className="shrink-0">/</span>
                        <span className="min-w-0 truncate">{seg}</span>
                    </span>
                ))}
            </div>
            <h1 className="text-2xl font-bold">
                <InlineText
                    value={project.name}
                    placeholder="Project name"
                    onSubmit={(name) => patch({ name })}
                />
            </h1>
            <div className="min-w-0 flex items-baseline gap-3 justify-between">
                <p className="font-mono text-xs text-[var(--muted-foreground)] truncate">
                    <InlineText
                        value={project.base_branch}
                        placeholder="branch"
                        onSubmit={(base_branch) => patch({ base_branch })}
                    />
                </p>
                <Link
                    href={`/p/${project.id}/details`}
                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                    details
                </Link>
            </div>
        </header>
    );
}
