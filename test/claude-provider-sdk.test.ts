import { beforeEach, expect, test, vi } from 'vitest'

import { createTaskPrompt } from './task-source-test-helpers'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'

const mockState = vi.hoisted(
  (): { messages: unknown[]; queryArgs: unknown } => {
    return {
      messages: [],
      queryArgs: null,
    }
  },
)

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(async function* (args: unknown) {
      mockState.queryArgs = args
      for (const msg of mockState.messages) {
        yield msg
      }
    }),
  }
})

beforeEach(() => {
  mockState.queryArgs = null
  mockState.messages = []
})

test('createClaudeProvider returns a provider with name claude that implements both roles', async () => {
  mockState.messages = [
    {
      result: 'ok',
      subtype: 'success',
      type: 'result',
      structured_output: {
        assumptions: [],
        needsHumanAttention: false,
        notes: [],
        status: 'implemented',
        summary: 'ok',
        taskHandle: 'T001',
        unresolvedItems: [],
      },
    },
  ]

  const { createClaudeProvider } = await import('../src/agents/claude')

  const provider: ImplementerProvider & ReviewerProvider = createClaudeProvider(
    {
      workspaceRoot: '/tmp/project',
    },
  )

  expect(provider.name).toBe('claude')

  const result = await provider.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(result.taskHandle).toBe('T001')
})
