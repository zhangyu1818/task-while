import { expect, test } from 'vitest'

import { buildImplementerPrompt } from '../src/prompts/implementer'

test('buildImplementerPrompt makes while task boundaries explicit', async () => {
  const prompt = await buildImplementerPrompt({
    attempt: 2,
    taskHandle: 'T001',
    lastFindings: [
      {
        file: 'src/greeting.ts',
        fixHint: 'match the plan',
        issue: 'output text does not satisfy acceptance',
        severity: 'medium',
      },
    ],
    prompt: {
      instructions: [
        'Implement only the current task.',
        'Use the provided source documents as the source of truth.',
        'Modify only the files that are reasonably required for the current task.',
        'Do not modify tasks.md.',
        'Do not move to the next task.',
        'Do not declare the task finalized.',
      ],
      sections: [
        { content: '- [ ] T001 Implement greeting', title: 'Task' },
        { content: 'Phase 1: Core', title: 'Phase' },
        { content: '# spec', title: 'Spec' },
        { content: '# plan', title: 'Plan' },
        {
          content: '## Phase 1: Core\n\n- [ ] T001 Implement greeting',
          title: 'Tasks',
        },
      ],
    },
  })

  expect(prompt).toContain('Return JSON only.')
  expect(prompt).toContain('Implement only the current task.')
  expect(prompt).toContain(
    'Use the provided source documents as the source of truth.',
  )
  expect(prompt).toContain(
    'Modify only the files that are reasonably required for the current task.',
  )
  expect(prompt).toContain('Do not modify tasks.md.')
  expect(prompt).toContain('Do not move to the next task.')
  expect(prompt).toContain('Do not declare the task finalized.')
  expect(prompt).toContain('Task Handle: T001')
  expect(prompt).toContain('Attempt:\n2')
  expect(prompt).toContain('Previous Findings:')
  expect(prompt).toContain('"file":"src/greeting.ts"')
  expect(prompt).toContain('"issue":"output text does not satisfy acceptance"')
  expect(prompt).toMatch(/# spec/)
  expect(prompt).toMatch(/# plan/)
  expect(prompt).toContain('- [ ] T001 Implement greeting')
  expect(prompt).toContain('Phase 1: Core')
})
