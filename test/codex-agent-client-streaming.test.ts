import { beforeEach, expect, test, vi } from 'vitest'

import { CodexAgentClient, type CodexClientLike } from '../src/agents/codex'
import { createTaskPrompt } from './task-source-test-helpers'

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

test('CodexAgentClient streams events when progress callback is enabled', async () => {
  const seenEvents: string[] = []
  let runCallCount = 0
  let runStreamedCallCount = 0

  mockState.client = {
    startThread() {
      return {
        async run() {
          runCallCount += 1
          return {
            finalResponse: JSON.stringify({ ok: false }),
          }
        },
        async runStreamed() {
          runStreamedCallCount += 1
          return {
            events: (async function* () {
              yield { thread_id: 'thread-1', type: 'thread.started' as const }
              yield { type: 'turn.started' as const }
              yield {
                type: 'item.completed' as const,
                item: {
                  type: 'agent_message' as const,
                  text: JSON.stringify({
                    assumptions: [],
                    needsHumanAttention: false,
                    notes: [],
                    status: 'implemented',
                    summary: 'ok',
                    taskHandle: 'T001',
                    unresolvedItems: [],
                  }),
                },
              }
              yield {
                type: 'turn.completed' as const,
                usage: {
                  cached_input_tokens: 0,
                  input_tokens: 1,
                  output_tokens: 1,
                },
              }
            })(),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
    onEvent(event) {
      seenEvents.push(event.type)
    },
  })

  const result = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(runCallCount).toBe(0)
  expect(runStreamedCallCount).toBe(1)
  expect(seenEvents).toEqual([
    'thread.started',
    'turn.started',
    'item.completed',
    'turn.completed',
  ])
  expect(result.taskHandle).toBe('T001')
})
