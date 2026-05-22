'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Project } from '@coro/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
    project: Project;
}

export function ProjectMetaEditor({ project: initial }: Props) {
    const [brief, setBrief] = useState(initial.project_brief || '');
    const [baseBranch, setBaseBranch] = useState(initial.base_branch);
    const [defaultModel, setDefaultModel] = useState(initial.default_model || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const dirty =
        (brief || null) !== (initial.project_brief || null) ||
        baseBranch !== initial.base_branch ||
        (defaultModel || null) !== (initial.default_model || null);

    async function save() {
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await api.patch(`/projects/${initial.id}`, {
                project_brief: brief.trim() || null,
                base_branch: baseBranch.trim() || initial.base_branch,
                default_model: defaultModel.trim() || null,
            });
            setSaved(true);
        } catch (err: any) {
            setError(err.body?.error?.message || err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-5">
            <div>
                <label className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                    Project brief
                </label>
                <p className="text-xs text-[var(--muted-foreground)] mb-2">
                    Injected into every card&apos;s Claude system prompt. Use ~200–500 chars to describe the codebase, conventions, and constraints.
                </p>
                <Textarea
                    rows={5}
                    value={brief}
                    onChange={(e) => { setBrief(e.target.value); setSaved(false); }}
                    placeholder="e.g. Coro is a kanban board for Claude Code conversations. TypeScript, Node ≥ 22, Hono daemon, Next.js dashboard..."
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{brief.length} chars</p>
            </div>

            <div>
                <label className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                    Base branch
                </label>
                <input
                    value={baseBranch}
                    onChange={(e) => { setBaseBranch(e.target.value); setSaved(false); }}
                    className="w-full max-w-sm rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
                />
            </div>

            <div>
                <label className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                    Default model
                </label>
                <input
                    value={defaultModel}
                    onChange={(e) => { setDefaultModel(e.target.value); setSaved(false); }}
                    placeholder="(uses Claude Code default)"
                    className="w-full max-w-sm rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--foreground)]"
                />
            </div>

            <div className="flex items-center gap-3">
                <Button size="sm" onClick={save} disabled={busy || !dirty}>
                    {busy ? 'Saving…' : 'Save'}
                </Button>
                {error && <span className="text-xs text-[var(--muted-foreground)]">{error}</span>}
                {saved && !error && <span className="text-xs text-[var(--muted-foreground)]">Saved.</span>}
            </div>
        </div>
    );
}
