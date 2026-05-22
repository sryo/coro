import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { Project } from '@coro/types';
import { ProjectDetails } from '@/components/project-details';

interface FileListResponse {
    files: { name: string; exists: boolean; size?: number; mtime?: number }[];
}

export default async function DetailsPage({ params }: { params: Promise<{ projectId: string }> }) {
    const { projectId } = await params;
    const [project, files] = await Promise.all([
        serverGet<Project>(`/projects/${projectId}`),
        serverGet<FileListResponse>(`/projects/${projectId}/files`),
    ]);
    if (!project) notFound();

    return (
        <main className="min-h-screen">
            <ProjectDetails project={project} files={files?.files || []} />
        </main>
    );
}
