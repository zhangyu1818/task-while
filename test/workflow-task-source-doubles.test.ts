import { expect, test } from 'vitest'

import { createRuntime } from './workflow-test-helpers'

test('default workflow task source derives completion criteria from raw task lines', async () => {
  const { runtime } = createRuntime()

  await expect(
    runtime.taskSource.getCompletionCriteria('T001'),
  ).resolves.toEqual(['Implement greeting'])
  await expect(
    runtime.taskSource.getCompletionCriteria('T002'),
  ).resolves.toEqual(['Implement farewell'])
})

test('workflow task source double returns source prompt without runtime metadata sections', async () => {
  const { runtime } = createRuntime()

  const implementPrompt = await runtime.taskSource.buildImplementPrompt({
    attempt: 2,
    generation: 3,
    taskHandle: 'T001',
    lastFindings: [
      {
        file: 'src/greeting.ts',
        fixHint: 'match task line',
        issue: 'wrong output',
        severity: 'medium',
      },
    ],
  })
  const reviewPrompt = await runtime.taskSource.buildReviewPrompt({
    actualChangedFiles: ['src/greeting.ts'],
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
        file: 'src/greeting.ts',
        fixHint: 'match task line',
        issue: 'wrong output',
        severity: 'medium',
      },
    ],
  })

  expect(implementPrompt.sections.map((section) => section.title)).toEqual([
    'Task',
    'Phase',
    'Spec',
    'Plan',
    'Tasks',
  ])
  expect(reviewPrompt.sections.map((section) => section.title)).toEqual([
    'Task',
    'Phase',
    'Spec',
    'Plan',
    'Tasks',
  ])
})
