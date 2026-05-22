// Shared types for the coro workspace. Zero runtime dependencies — this
// package compiles to declarations + an empty JS module so dashboards and
// scripts can import canonical shapes without pulling in better-sqlite3 etc.

export type StageKind = 'backlog' | 'ready' | 'active' | 'review' | 'done' | 'archive';

export type EventKind = 'stage_change' | 'note' | 'merge' | 'abandon';

export type EventActor = 'user' | 'agent' | 'system';

export type Actor = EventActor;

export interface Project {
    id: string;
    name: string;
    repo_path: string;
    base_branch: string;
    default_model: string | null;
    project_brief: string | null;
    settings_json: string;
    created_at: number;
}

export interface Stage {
    id: string;
    project_id: string;
    name: string;
    position: number;
    kind: StageKind;
    created_at: number;
}

export interface Card {
    id: string;
    project_id: string;
    slug: string;
    title: string;
    description: string | null;
    stage_id: string;
    branch_name: string | null;
    worktree_path: string | null;
    base_sha: string | null;
    model_override: string | null;
    position: number;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    testing_at: number | null;
    review_at: number | null;
    done_at: number | null;
    merged_at: number | null;
    abandoned_at: number | null;
}

export interface Message {
    id: number;
    conversation_id: string;
    message_id: string;
    turn_id: string;
    role: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
    content_text: string | null;
    content_json: string | null;
    tool_name: string | null;
    streaming_complete: number;
    created_at: number;
}

export interface WorktreeRecord {
    id: string;
    card_id: string;
    path: string;
    branch: string;
    base_branch: string;
    base_sha: string;
    repo_path: string;
    state: 'active' | 'merged' | 'abandoned' | 'missing';
    last_seen_at: number;
    created_at: number;
    dirty_files: number;
    behind: number;
    merge_conflict_at: number | null;
}

export interface WorktreeStatus {
    path: string;
    branch: string;
    base_branch: string;
    base_sha: string;
    ahead: number;
    behind: number;
    dirty_files: number;
    last_commit: { sha: string; subject: string; iso: string } | null;
    exists: boolean;
}

export interface WorktreeBoardMeta {
    state: string;
    dirty_files: number;
    behind: number;
    merge_conflict_at: number | null;
}

export interface ErrorResponse {
    error: {
        code: string;
        message: string;
        hint?: string;
        allowed?: string[];
        conflicts?: string[];
        dirty_files?: number;
    };
}
