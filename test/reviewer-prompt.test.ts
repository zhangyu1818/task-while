import { expect, test } from 'vitest'

import { buildReviewerPrompt } from '../src/prompts/reviewer'

test('buildReviewerPrompt keeps review context path-only', async () => {
  const prompt = await buildReviewerPrompt({
    actualChangedFiles: ['src/parser.ts'],
    attempt: 2,
    generation: 3,
    taskHandle: 'T001',
    implement: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented',
      summary: 'done',
      taskHandle: 'T001',
      unresolvedItems: [],
    },
    lastFindings: [
      {
        file: 'src/parser.ts',
        fixHint: 'tighten boundary',
        issue: 'missed edge case',
        severity: 'medium',
      },
    ],
    prompt: {
      instructions: [
        'Review only the current task.',
        'Use the provided source documents to judge whether the task matches the intended implementation.',
        'Evaluate the task description, source documents, actual changed files, and overall risk.',
        'Only return verdict "pass" when the current task is satisfied by the implementation.',
        'acceptanceChecks must stay consistent with the current task description.',
        'Do not expand the review to unrelated files or repository-wide history.',
      ],
      sections: [
        { content: '- [ ] T001 Create parser', title: 'Task' },
        { content: 'Phase 1: Core', title: 'Phase' },
        { content: '# spec', title: 'Spec' },
        { content: '# plan', title: 'Plan' },
        {
          content: '## Phase 1: Core\n\n- [ ] T001 Create parser',
          title: 'Tasks',
        },
      ],
    },
  })

  expect(prompt).toMatch(/# spec/)
  expect(prompt).toMatch(/# plan/)
  expect(prompt).toMatch(/Task Handle: T001/)
  expect(prompt).toContain('Attempt:\n2')
  expect(prompt).toContain('Generation:\n3')
  expect(prompt).toContain('Previous Findings:')
  expect(prompt).toContain('"file":"src/parser.ts"')
  expect(prompt).toContain('Actual Changed Files:')
  expect(prompt).toContain('["src/parser.ts"]')
  expect(prompt).toContain('Implement Result:')
  expect(prompt).toContain('"summary":"done"')
  expect(prompt).toContain('- [ ] T001 Create parser')
  expect(prompt).toContain('Phase 1: Core')
  expect(prompt).toContain(
    'Use the provided source documents to judge whether the task matches the intended implementation.',
  )
  expect(prompt).toContain(
    'Evaluate the task description, source documents, actual changed files, and overall risk.',
  )
  expect(prompt).toContain(
    'Only return verdict "pass" when the current task is satisfied by the implementation.',
  )
  expect(prompt).toContain(
    'acceptanceChecks must stay consistent with the current task description.',
  )
  expect(prompt).toContain(
    'Do not expand the review to unrelated files or repository-wide history.',
  )
  expect(prompt).not.toMatch(/export const value/)
})
