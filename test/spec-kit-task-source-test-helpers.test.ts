import { expect, test } from 'vitest'

import { readSpecKitCompletionCriteriaFromPrompt } from './spec-kit-task-source-test-helpers'
import { createTaskPrompt } from './task-source-test-helpers'

test('spec-kit completion criteria helper derives a single criterion from a raw task line', () => {
  const prompt = createTaskPrompt({
    taskHandle: 'T001',
    taskLine: '- [ ] T001 [P] [US1] Implement greeting',
    title: 'Implement greeting',
  })

  expect(readSpecKitCompletionCriteriaFromPrompt(prompt)).toEqual([
    'Implement greeting',
  ])
})
