import type { ReviewAgentInput } from '../agents/types'

export async function buildReviewerPrompt(input: ReviewAgentInput) {
  return [
    'Return JSON only.',
    ...input.prompt.instructions,
    `Task Handle: ${input.taskHandle}`,
    ...[
      ...input.prompt.sections,
      { content: String(input.attempt), title: 'Attempt' },
      {
        content: JSON.stringify(input.lastFindings),
        title: 'Previous Findings',
      },
      {
        content: JSON.stringify(input.actualChangedFiles),
        title: 'Actual Changed Files',
      },
      {
        content: JSON.stringify(input.implement),
        title: 'Implement Result',
      },
    ].map((section) => `${section.title}:\n${section.content}`),
  ].join('\n\n')
}
