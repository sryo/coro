import { z } from 'zod';

const actorSchema = z.enum(['user', 'agent', 'system']);
const stageKindSchema = z.enum(['backlog', 'ready', 'active', 'review', 'done', 'archive']);

export const createCardBody = z.object({
    title: z.string().min(1, 'title required').max(200, 'title must be ≤ 200 chars'),
    description: z.string().optional(),
    stage_id: z.string().optional(),
    model_override: z.string().optional(),
});

// PATCH is partial — only the fields the caller wants to change.
export const updateCardBody = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    model_override: z.string().nullable().optional(),
}).strict();

export const transitionBody = z.object({
    to_stage_id: z.string().min(1, 'to_stage_id required'),
    actor: actorSchema.optional(),
    reason: z.string().optional(),
});

export const noteBody = z.object({
    content: z.string().trim().min(1, 'content required'),
    actor: actorSchema.optional(),
    kind: z.enum(['info', 'question']).optional(),
});

export const mergeBody = z.object({
    strategy: z.enum(['squash', 'merge']).optional(),
    commit_message: z.string().optional(),
    actor: actorSchema.optional(),
});

export const abandonBody = z.object({
    stash_dirty: z.boolean().optional(),
    actor: actorSchema.optional(),
});

export const createProjectBody = z.object({
    name: z.string().optional(),
    repo_path: z.string().min(1, 'repo_path required'),
    base_branch: z.string().optional(),
});

export const updateProjectBody = z.object({
    name: z.string().optional(),
    base_branch: z.string().optional(),
    default_model: z.string().nullable().optional(),
    project_brief: z.string().nullable().optional(),
    settings_json: z.string().optional(),
}).strict();

export const stageInputSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    kind: stageKindSchema,
});

export const replaceStagesBody = z.object({
    stages: z.array(stageInputSchema).min(1, 'stages array required'),
});

export const sendMessageBody = z.object({
    content: z.string().trim().min(1, 'content required'),
    client_message_id: z.string().optional(),
});

export const renameBranchBody = z.object({
    branch_name: z.string().min(1, 'branch_name required'),
}).strict();

export type CreateCardBody = z.infer<typeof createCardBody>;
export type UpdateCardBody = z.infer<typeof updateCardBody>;
export type TransitionBody = z.infer<typeof transitionBody>;
export type NoteBody = z.infer<typeof noteBody>;
export type MergeBody = z.infer<typeof mergeBody>;
export type AbandonBody = z.infer<typeof abandonBody>;
export type CreateProjectBody = z.infer<typeof createProjectBody>;
export type UpdateProjectBody = z.infer<typeof updateProjectBody>;
export type ReplaceStagesBody = z.infer<typeof replaceStagesBody>;
export type SendMessageBody = z.infer<typeof sendMessageBody>;
