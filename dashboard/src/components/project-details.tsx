'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Project } from '@coro/types';

interface FileInfo {
    name: string;
    exists: boolean;
    size?: number;
    mtime?: number;
}

interface Props {
    project: Project;
    files: FileInfo[];
}

export function ProjectDetails({ project, files }: Props) {
    const router = useRouter();

    async function saveBrief(brief: string) {
        await api.patch<Project>(`/projects/${project.id}`, { project_brief: brief || null });
        router.refresh();
    }

    return (
        <div className="mx-auto max-w-[70ch] px-8 py-10 space-y-12">
            <header>
                <Link
                    href={`/p/${project.id}`}
                    className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                    ← {project.name}
                </Link>
                <h1 className="mt-2 text-2xl font-bold">Details</h1>
            </header>

            <section>
                <h2 className="text-sm font-semibold mb-2">Brief</h2>
                <p className="text-xs text-[var(--muted-foreground)] mb-3">
                    Injected into every card&apos;s Claude system prompt.
                </p>
                <FileEditor
                    initialContent={project.project_brief || ''}
                    placeholder="Tell Claude about this codebase…"
                    onSave={saveBrief}
                    rows={6}
                />
            </section>

            {files.map((file) => (
                <section key={file.name}>
                    <h2 className="text-sm font-semibold mb-2 font-mono">{file.name}</h2>
                    <RepoFileEditor projectId={project.id} name={file.name} />
                </section>
            ))}
        </div>
    );
}

function RepoFileEditor({ projectId, name }: { projectId: string; name: string }) {
    const [content, setContent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.get<{ content: string }>(`/projects/${projectId}/files/${name}`)
            .then((res) => { if (!cancelled) setContent(res.content); })
            .catch((err) => { if (!cancelled) setError(err.body?.error?.message || err.message); });
        return () => { cancelled = true; };
    }, [projectId, name]);

    if (error) {
        return <p className="text-xs text-[var(--muted-foreground)]">{error}</p>;
    }
    if (content === null) {
        return <p className="text-xs text-[var(--muted-foreground)]">Loading…</p>;
    }

    async function save(next: string) {
        await api.put(`/projects/${projectId}/files/${name}`, { content: next });
        setContent(next);
    }

    return <FileEditor initialContent={content} onSave={save} rows={12} />;
}

function FileEditor({
    initialContent,
    placeholder,
    onSave,
    rows = 10,
}: {
    initialContent: string;
    placeholder?: string;
    onSave: (next: string) => Promise<void>;
    rows?: number;
}) {
    const [draft, setDraft] = useState(initialContent);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        setDraft(initialContent);
        setSaved(false);
    }, [initialContent]);

    const dirty = draft !== initialContent;

    async function save() {
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await onSave(draft);
            setSaved(true);
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <textarea
                rows={rows}
                value={draft}
                placeholder={placeholder}
                onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
                }}
                className="w-full resize-y rounded-md bg-[var(--muted)] px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                    type="button"
                    onClick={save}
                    disabled={busy || !dirty}
                    className="font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
                >
                    {busy ? 'saving…' : 'save'}
                </button>
                <span className="text-[var(--muted-foreground)]">⌘⏎</span>
                {error && <span className="text-[var(--muted-foreground)]">{error}</span>}
                {saved && !error && !dirty && <span className="text-[var(--muted-foreground)]">saved.</span>}
            </div>
        </div>
    );
}
