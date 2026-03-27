import type { ImplementAgentInput } from '../agents/types'

export async function buildImplementerPrompt(input: ImplementAgentInput) {
  return [
    'Return JSON only.',
    ...input.prompt.instructions,
    `Task Handle: ${input.taskHandle}`,
    ...[
      ...input.prompt.sections,
      { content: String(input.attempt), title: 'Attempt' },
      { content: String(input.generation), title: 'Generation' },
      {
        content: JSON.stringify(input.lastFindings),
        title: 'Previous Findings',
      },
    ].map((section) => `${section.title}:\n${section.content}`),
  ].join('\n\n')
}
