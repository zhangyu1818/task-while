import { expect, test } from 'vitest'

import {
  validateImplementOutput,
  validateReviewOutput,
} from '../src/schema/index'

test('validateImplementOutput accepts the current implement output contract', () => {
  const result = validateImplementOutput({
    assumptions: ['uses existing helper'],
    needsHumanAttention: false,
    notes: ['updated tests'],
    status: 'implemented',
    summary: 'done',
    taskHandle: 'T001',
    unresolvedItems: [],
  })

  expect(result).toMatchObject({
    status: 'implemented',
    taskHandle: 'T001',
  })
})

test('validateImplementOutput rejects duplicate unresolved items', () => {
  expect(() => {
    validateImplementOutput({
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'partial',
      summary: 'still working',
      taskHandle: 'T001',
      unresolvedItems: ['follow up', 'follow up'],
    })
  }).toThrow(/duplicate unresolved item/i)
})

test('validateReviewOutput accepts the current review output contract', () => {
  const result = validateReviewOutput({
    findings: [],
    overallRisk: 'low',
    summary: 'looks good',
    taskHandle: 'T001',
    verdict: 'pass',
    acceptanceChecks: [
      {
        criterion: 'task output matches prompt',
        note: 'current diff satisfies task',
        status: 'pass',
      },
    ],
  })

  expect(result).toMatchObject({
    overallRisk: 'low',
    verdict: 'pass',
  })
})

test('validateReviewOutput rejects pass verdicts with remaining findings', () => {
  expect(() => {
    validateReviewOutput({
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskHandle: 'T001',
      verdict: 'pass',
      acceptanceChecks: [
        {
          criterion: 'works',
          note: 'ok',
          status: 'pass',
        },
      ],
      findings: [
        {
          file: 'src/a.ts',
          fixHint: 'remove dead branch',
          issue: 'dead branch remains',
          severity: 'medium',
        },
      ],
    })
  }).toThrow(/pass requires empty findings/i)
})

test('validateReviewOutput rejects pass verdicts with failed acceptance checks', () => {
  expect(() => {
    validateReviewOutput({
      findings: [],
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskHandle: 'T001',
      verdict: 'pass',
      acceptanceChecks: [
        {
          criterion: 'works',
          note: 'still broken',
          status: 'fail',
        },
      ],
    })
  }).toThrow(/pass requires all acceptance checks to pass/i)
})
