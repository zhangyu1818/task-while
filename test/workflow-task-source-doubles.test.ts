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

  const implementPrompt = await runtime.taskSource.buildImplementPrompt('T001')
  const reviewPrompt = await runtime.taskSource.buildReviewPrompt('T001')

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
