import { createHash } from 'crypto';
import type { Card } from '../cards';
import type { Project } from '../projects';
import type { Stage } from '../stages';

export function buildSystemPrompt(card: Card, project: Project, stages: Stage[]): string {
    const currentStage = stages.find((s) => s.id === card.stage_id);
    const stagesList = stages.map((s) => `  - ${s.name} (${s.kind})`).join('\n');

    return `You are working on a Concerto card in a git worktree.

Card: ${card.title}
Description: ${card.description || '(none)'}
Current stage: ${currentStage?.name || 'unknown'} (${currentStage?.kind || 'unknown'})
${project.project_brief ? `Project brief: ${project.project_brief}` : ''}
Worktree: ${card.worktree_path || '(none — card is not in an active stage)'}
Base branch: ${project.base_branch}

Stages in this project:
${stagesList}

Rules:
- Don't auto-commit unless the user asks; the user owns git history.
- Don't push, merge, or rebase unless explicitly asked.
- When work is testable, say so in your reply. When work is complete, ask for review.
- Stay focused on this card. Don't touch other cards' worktrees.
- The user can move the card between stages from the dashboard or via the /concerto skill.

(In a future milestone, you'll have MCP tools to move the card yourself — concerto.set_status, concerto.add_note, concerto.request_review. For now, communicate status changes in plain text.)`;
}

export function hashSystemPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}
