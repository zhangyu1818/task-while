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

function createImplementResult() {
  return {
    assumptions: [],
    needsHumanAttention: false,
    notes: [],
    status: 'implemented' as const,
    summary: 'done',
    taskHandle: 'T001',
    unresolvedItems: [],
  }
}

function createSuccessResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    result: 'ok',
    structured_output: createImplementResult(),
    subtype: 'success',
    type: 'result',
    ...overrides,
  }
}

test('ClaudeAgentClient.implement passes prompt and outputFormat to query and returns structured output', async () => {
  const implementResult = createImplementResult()

  mockState.messages = [
    {
      result: 'ok',
      structured_output: implementResult,
      subtype: 'success',
      type: 'result',
    },
  ]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  const result = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: 'T001',
    prompt: createTaskPrompt({
      taskHandle: 'T001',
      title: 'Create parser',
    }),
  })

  expect(result.taskHandle).toBe('T001')
  expect(result.status).toBe('implemented')

  const args = mockState.queryArgs as {
    options: { cwd: string; outputFormat: unknown }
    prompt: string
  }
  expect(args.prompt).toMatch(/Create parser/)
  expect(args.options.cwd).toBe('/tmp/project')
  expect(args.options.outputFormat).toMatchObject({
    type: 'json_schema',
  })
})

test('ClaudeAgentClient.review passes prompt and outputFormat to query and returns structured output', async () => {
  const reviewResult = {
    acceptanceChecks: [{ criterion: 'works', note: 'ok', status: 'pass' }],
    findings: [],
    overallRisk: 'low',
    summary: 'ok',
    taskHandle: 'T001',
    verdict: 'pass',
  }

  mockState.messages = [
    {
      result: 'ok',
      structured_output: reviewResult,
      subtype: 'success',
      type: 'result',
    },
  ]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  const result = await client.review({
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
  })

  expect(result.verdict).toBe('pass')
  expect(result.taskHandle).toBe('T001')
})

test('ClaudeAgentClient passes configured model and effort defaults to query options', async () => {
  mockState.messages = [createSuccessResultMessage()]

  const client = new ClaudeAgentClient({
    effort: 'max',
    model: 'claude-sonnet-4-6',
    workspaceRoot: '/tmp/project',
  })

  await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  const args = mockState.queryArgs as {
    options: { effort?: string; model?: string }
  }
  expect(args.options.model).toBe('claude-sonnet-4-6')
  expect(args.options.effort).toBe('max')
})

test('ClaudeAgentClient throws when query returns error result', async () => {
  mockState.messages = [
    {
      errors: ['model refused'],
      subtype: 'error_during_execution',
      type: 'result',
    },
  ]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await expect(
    client.implement({
      attempt: 1,
      generation: 1,
      lastFindings: [],
      prompt: createTaskPrompt(),
      taskHandle: 'T001',
    }),
  ).rejects.toThrow(/claude agent query failed/i)
})

test('ClaudeAgentClient throws when query returns no structured output', async () => {
  mockState.messages = [
    {
      result: 'ok',
      structured_output: null,
      subtype: 'success',
      type: 'result',
    },
  ]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await expect(
    client.implement({
      attempt: 1,
      generation: 1,
      lastFindings: [],
      prompt: createTaskPrompt(),
      taskHandle: 'T001',
    }),
  ).rejects.toThrow(/no structured output/i)
})

test('ClaudeAgentClient throws when query yields no messages', async () => {
  mockState.messages = []

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await expect(
    client.implement({
      attempt: 1,
      generation: 1,
      lastFindings: [],
      prompt: createTaskPrompt(),
      taskHandle: 'T001',
    }),
  ).rejects.toThrow(/no structured output/i)
})

test('ClaudeAgentClient sets includePartialMessages only when onEvent is provided', async () => {
  mockState.messages = [createSuccessResultMessage()]

  const client = new ClaudeAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })

  const args = mockState.queryArgs as {
    options: {
      agentProgressSummaries?: boolean
      effort?: string
      includePartialMessages: boolean
      model?: string
    }
  }
  expect(args.options.includePartialMessages).toBe(false)
  expect('agentProgressSummaries' in args.options).toBe(false)
  expect('model' in args.options).toBe(false)
  expect('effort' in args.options).toBe(false)
})
