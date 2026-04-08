import { beforeEach, expect, expectTypeOf, test, vi } from 'vitest'

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

test('CodexAgentClient passes prompt and structured output schema to streamed SDK runs', async () => {
  let receivedPrompt = ''
  let receivedSchema: Record<string, unknown> | undefined

  mockState.client = {
    startThread() {
      return {
        async run() {
          throw new Error('run() should not be used in this test')
        },
        async runStreamed(prompt, runOptions) {
          receivedPrompt = prompt
          receivedSchema = runOptions.outputSchema
          return {
            events: (async function* () {
              yield { thread_id: 'thread-1', type: 'thread.started' as const }
              yield { type: 'turn.started' as const }
              yield {
                type: 'item.completed' as const,
                item: {
                  id: 'msg-1',
                  type: 'agent_message' as const,
                  text: JSON.stringify({
                    assumptions: [],
                    needsHumanAttention: false,
                    notes: [],
                    status: 'implemented',
                    summary: 'done',
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
    onEvent() {},
  })

  const result = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: 'T001',
    prompt: createTaskPrompt({
      completionCriteria: ['parser exists'],
      taskHandle: 'T001',
      tasksSnippet: '- [ ] T001 Create parser',
      title: 'Create parser',
    }),
  })

  expect(receivedPrompt).toMatch(/Create parser/)
  expect(receivedSchema?.required).toContain('taskHandle')
  expect(result.taskHandle).toBe('T001')
})

test('CodexAgentClient preserves structured item payloads for verbose rendering', async () => {
  const seenItems: unknown[] = []

  mockState.client = {
    startThread() {
      return {
        async run() {
          throw new Error('run() should not be used in this test')
        },
        async runStreamed() {
          return {
            events: (async function* () {
              yield { thread_id: 'thread-1', type: 'thread.started' as const }
              yield { type: 'turn.started' as const }
              yield {
                type: 'item.started' as const,
                item: {
                  id: 'reasoning-1',
                  text: 'Inspecting event logger',
                  type: 'reasoning' as const,
                },
              }
              yield {
                type: 'item.started' as const,
                item: {
                  id: 'cmd-1',
                  aggregated_output: '',
                  command: 'rg verbose src',
                  status: 'in_progress' as const,
                  type: 'command_execution' as const,
                },
              }
              yield {
                type: 'item.completed' as const,
                item: {
                  id: 'cmd-1',
                  aggregated_output: String.raw`src/agents/event-log.ts:12:[codex] item.completed\n`,
                  command: 'rg verbose src',
                  exit_code: 0,
                  status: 'completed' as const,
                  type: 'command_execution' as const,
                },
              }
              yield {
                type: 'item.started' as const,
                item: {
                  id: 'tool-1',
                  arguments: { query: 'codex sdk verbose renderer' },
                  server: 'brave_search',
                  status: 'in_progress' as const,
                  tool: 'search',
                  type: 'mcp_tool_call' as const,
                },
              }
              yield {
                type: 'item.updated' as const,
                item: {
                  id: 'todo-1',
                  items: [{ completed: true, text: 'Inspect renderer' }],
                  type: 'todo_list' as const,
                },
              }
              yield {
                type: 'item.completed' as const,
                item: {
                  id: 'msg-1',
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
      if (
        event.type === 'item.started' ||
        event.type === 'item.updated' ||
        event.type === 'item.completed'
      ) {
        if (event.item.type === 'reasoning') {
          expectTypeOf(event.item).toMatchTypeOf<{
            id: string
            text: string
            type: 'reasoning'
          }>()
        }
        if (event.item.type === 'command_execution') {
          expectTypeOf(event.item).toMatchTypeOf<{
            aggregated_output: string
            command: string
            id: string
            status: 'completed' | 'failed' | 'in_progress'
            type: 'command_execution'
          }>()
        }
        if (event.item.type === 'mcp_tool_call') {
          expectTypeOf(event.item).toMatchTypeOf<{
            arguments: unknown
            id: string
            server: string
            status: 'completed' | 'failed' | 'in_progress'
            tool: string
            type: 'mcp_tool_call'
          }>()
        }
        seenItems.push(event.item)
      }
    },
  })

  const result = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(seenItems).toEqual([
    {
      id: 'reasoning-1',
      text: 'Inspecting event logger',
      type: 'reasoning',
    },
    {
      id: 'cmd-1',
      aggregated_output: '',
      command: 'rg verbose src',
      status: 'in_progress',
      type: 'command_execution',
    },
    {
      id: 'cmd-1',
      aggregated_output: String.raw`src/agents/event-log.ts:12:[codex] item.completed\n`,
      command: 'rg verbose src',
      exit_code: 0,
      status: 'completed',
      type: 'command_execution',
    },
    {
      id: 'tool-1',
      arguments: { query: 'codex sdk verbose renderer' },
      server: 'brave_search',
      status: 'in_progress',
      tool: 'search',
      type: 'mcp_tool_call',
    },
    {
      id: 'todo-1',
      items: [{ completed: true, text: 'Inspect renderer' }],
      type: 'todo_list',
    },
    {
      id: 'msg-1',
      type: 'agent_message',
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
  ])
  expect(result.taskHandle).toBe('T001')
})
