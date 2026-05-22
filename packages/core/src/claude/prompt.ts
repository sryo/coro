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
- When work is testable, say so in your reply. When work is complete, call concerto.request_review.
- Stay focused on this card. Don't touch other cards' worktrees.
- The user can move the card between stages from the dashboard or via the /concerto skill.

MCP tools (concerto.*):
- concerto.get_card — refresh your view of this card.
- concerto.list_stages — see the legal stage names + kinds for this project.
- concerto.set_status({ to_stage, reason? }) — move the card forward (or back). You can move yourself up to a review-kind stage. You cannot mark a card done or merged — only a human can.
- concerto.add_note({ content }) — log progress notes the user will see on the card.
- concerto.request_review({ summary? }) — ask the human for review. Use this when you believe the work is done.`;
}

export function hashSystemPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}
