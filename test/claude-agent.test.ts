import { expect, test } from 'vitest'

import { ClaudeAgentClient, createClaudeProvider } from '../src/agents/claude'
import { createTaskPrompt } from './task-source-test-helpers'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'

test('ClaudeAgentClient forwards implement and review to injected adapter', async () => {
  const calls: string[] = []
  const client = new ClaudeAgentClient({
    async implement(input) {
      calls.push(`implement:${input.taskHandle}`)
      return {
        assumptions: [],
        needsHumanAttention: false,
        notes: [],
        status: 'implemented',
        summary: 'ok',
        taskHandle: input.taskHandle,
        unresolvedItems: [],
      }
    },
    async review(input) {
      calls.push(`review:${input.taskHandle}`)
      return {
        findings: [],
        overallRisk: 'low',
        summary: 'ok',
        taskHandle: input.taskHandle,
        verdict: 'pass',
        acceptanceChecks: [
          {
            criterion: 'works',
            note: 'ok',
            status: 'pass',
          },
        ],
      }
    },
  })

  const implement = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })
  const review = await client.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    implement,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(implement.taskHandle).toBe('T001')
  expect(review.verdict).toBe('pass')
  expect(calls).toEqual(['implement:T001', 'review:T001'])
})

test('ClaudeAgentClient default adapter throws explicit configuration errors', async () => {
  const client = new ClaudeAgentClient()

  await expect(
    client.implement({
      attempt: 1,
      generation: 1,
      lastFindings: [],
      prompt: createTaskPrompt(),
      taskHandle: 'T001',
    }),
  ).rejects.toThrow(/claude agent adapter is not configured/i)

  await expect(
    client.review({
      actualChangedFiles: ['src/a.ts'],
      attempt: 1,
      generation: 1,
      lastFindings: [],
      prompt: createTaskPrompt(),
      taskHandle: 'T001',
      implement: {
        assumptions: [],
        needsHumanAttention: false,
        notes: [],
        status: 'implemented',
        summary: 'ok',
        taskHandle: 'T001',
        unresolvedItems: [],
      },
    }),
  ).rejects.toThrow(/claude agent adapter is not configured/i)
})

test('createClaudeProvider returns a role-scoped claude provider', async () => {
  const provider: ImplementerProvider & ReviewerProvider = createClaudeProvider(
    {
      async implement(input) {
        return {
          assumptions: [],
          needsHumanAttention: false,
          notes: [],
          status: 'implemented',
          summary: 'ok',
          taskHandle: input.taskHandle,
          unresolvedItems: [],
        }
      },
      async review(input) {
        return {
          findings: [],
          overallRisk: 'low',
          summary: 'ok',
          taskHandle: input.taskHandle,
          verdict: 'pass',
          acceptanceChecks: [
            {
              criterion: 'works',
              note: 'ok',
              status: 'pass',
            },
          ],
        }
      },
    },
  )

  const implement = await provider.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })
  const review = await provider.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    implement,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(provider.name).toBe('claude')
  expect(implement.taskHandle).toBe('T001')
  expect(review.verdict).toBe('pass')
})
