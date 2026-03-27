import { beforeEach, expect, test, vi } from 'vitest'

import { createCodexProvider, type CodexClientLike } from '../src/agents/codex'
import { createTaskPrompt } from './task-source-test-helpers'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'

const mockState = vi.hoisted(() => {
  return {
    client: null as CodexClientLike | null,
    constructorCalls: 0,
  }
})

vi.mock('@openai/codex-sdk', () => {
  return {
    Codex: function MockCodex() {
      mockState.constructorCalls += 1
      if (!mockState.client) {
        throw new Error('No mock Codex client configured')
      }
      return mockState.client
    },
  }
})

beforeEach(() => {
  mockState.client = null
  mockState.constructorCalls = 0
})

test('createCodexProvider returns a role-scoped codex provider', async () => {
  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: JSON.stringify({
              assumptions: [],
              needsHumanAttention: false,
              notes: [],
              status: 'implemented',
              summary: 'ok',
              taskHandle: 'T001',
              unresolvedItems: [],
            }),
          }
        },
      }
    },
  }

  const provider: ImplementerProvider & ReviewerProvider = createCodexProvider({
    workspaceRoot: '/tmp/project',
  })

  const implement = await provider.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(provider.name).toBe('codex')
  expect(implement.taskHandle).toBe('T001')
})
