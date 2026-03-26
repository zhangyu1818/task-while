import type { ReviewAgentInput } from '../agents/types'

export async function buildReviewerPrompt(input: ReviewAgentInput) {
  return [
    'Return JSON only.',
    'Review only the current task.',
    'Use spec.md, plan.md, and the provided tasks snippet to judge whether the task matches the intended implementation.',
    'Evaluate task acceptance, spec/plan alignment, actual changed files, and overall risk.',
    'Only return verdict "pass" when every acceptance criterion is satisfied.',
    'If verdict is "pass", findings must be an empty array and every acceptanceChecks entry must have status "pass".',
    'If any acceptance criterion is unmet or unclear, verdict must not be "pass".',
    'acceptanceChecks must cover every acceptance criterion for the current task.',
    'Check that verdict, findings, acceptanceChecks, and summary are mutually consistent before returning.',
    'Use actualChangedFiles to inspect code in the workspace when needed.',
    'Do not rely only on the implementer summary.',
    'Do not expand the review to unrelated files or repository-wide history.',
    `Task: ${JSON.stringify(input.task)}`,
    `Generation: ${input.generation}`,
    `Attempt: ${input.attempt}`,
    `Previous Findings: ${JSON.stringify(input.lastFindings)}`,
    `Spec:\n${input.spec}`,
    `Plan:\n${input.plan}`,
    `Tasks Snippet:\n${input.tasksSnippet}`,
    `Actual Changed Files: ${JSON.stringify(input.actualChangedFiles)}`,
    `Implement Result: ${JSON.stringify(input.implement)}`,
  ].join('\n\n')
}
