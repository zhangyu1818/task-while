import { beforeEach, expect, test, vi } from 'vitest'

import { ClaudeAgentClient } from '../src/agents/claude'
import { createTaskPrompt } from './task-source-test-helpers'

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

function createSuccessResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    result: 'ok',
    subtype: 'success',
    type: 'result',
    structured_output: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented' as const,
      summary: 'done',
      taskHandle: 'T001',
      unresolvedItems: [],
    },
    ...overrides,
  }
}

test('ClaudeAgentClient forwards detailed verbose events to onEvent handler', async () => {
  const seenEvents: unknown[] = []

  mockState.messages = [
    {
      mcp_servers: [{ name: 'brave-search', status: 'connected' }],
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      skills: ['deep-search'],
      subtype: 'init',
      tools: ['Read', 'Edit'],
      type: 'system',
    },
    {
      description: 'Inspect verbose logger',
      subtype: 'task_started',
      task_id: 'task-1',
      type: 'system',
    },
    {
      elapsed_time_seconds: 1,
      tool_name: 'Read',
      tool_use_id: 'tool-1',
      type: 'tool_progress',
    },
    {
      preceding_tool_use_ids: ['tool-1'],
      summary: 'Read src/agents/event-log.ts',
      type: 'tool_use_summary',
    },
    {
      description: 'Inspect verbose logger',
      last_tool_name: 'Read',
      subtype: 'task_progress',
      summary: 'Inspected event-log.ts',
      task_id: 'task-1',
      type: 'system',
      usage: {
        duration_ms: 500,
        tool_uses: 1,
        total_tokens: 42,
      },
    },
    {
      type: 'stream_event',
      event: {
        delta: { text: 'hello', type: 'text_delta' },
        type: 'content_block_delta',
      },
    },
    {
      duration_ms: 1200,
      num_turns: 1,
      ...createSuccessResultMessage(),
    },
  ]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
    onEvent(event) {
      seenEvents.push(event)
    },
  })

  await client.implement({
    attempt: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  expect(seenEvents).toEqual([
    {
      mcpServers: [{ name: 'brave-search', status: 'connected' }],
      model: 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      skills: ['deep-search'],
      tools: ['Read', 'Edit'],
      type: 'system.init',
    },
    {
      description: 'Inspect verbose logger',
      taskId: 'task-1',
      type: 'task.started',
    },
    {
      elapsedTimeSeconds: 1,
      toolName: 'Read',
      toolUseId: 'tool-1',
      type: 'tool.progress',
    },
    {
      summary: 'Read src/agents/event-log.ts',
      type: 'tool.summary',
    },
    {
      description: 'Inspect verbose logger',
      lastToolName: 'Read',
      summary: 'Inspected event-log.ts',
      taskId: 'task-1',
      type: 'task.progress',
    },
    {
      delta: 'hello',
      type: 'text',
    },
    {
      durationMs: 1200,
      numTurns: 1,
      subtype: 'success',
      type: 'result',
    },
  ])
})

test('ClaudeAgentClient enables progress-oriented Claude query flags only when onEvent is provided', async () => {
  mockState.messages = [createSuccessResultMessage()]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
    onEvent() {},
  })

  await client.implement({
    attempt: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  const args = mockState.queryArgs as {
    options: {
      agentProgressSummaries?: boolean
      includePartialMessages: boolean
    }
  }
  expect(args.options.includePartialMessages).toBe(true)
  expect(args.options.agentProgressSummaries).toBe(true)
})
