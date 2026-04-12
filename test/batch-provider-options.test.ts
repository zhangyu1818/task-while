import { beforeEach, expect, test, vi } from 'vitest'

import type { ClaudeAgentClientOptions } from '../src/agents/claude'
import type { CodexAgentClientOptions } from '../src/agents/codex'

const clientState = vi.hoisted(() => ({
  claudeOptions: [] as ClaudeAgentClientOptions[],
  codexOptions: [] as CodexAgentClientOptions[],
}))

vi.mock('../src/agents/event-log', () => ({
  createClaudeEventHandler: vi.fn(() => undefined),
  createCodexEventHandler: vi.fn(() => undefined),
}))

vi.mock('../src/agents/codex', () => ({
  CodexAgentClient: function MockCodexAgentClient(
    this: unknown,
    options: CodexAgentClientOptions,
  ) {
    clientState.codexOptions.push(options)
  },
}))

vi.mock('../src/agents/claude', () => ({
  ClaudeAgentClient: function MockClaudeAgentClient(
    this: unknown,
    options: ClaudeAgentClientOptions,
  ) {
    clientState.claudeOptions.push(options)
  },
}))

const { createBatchStructuredOutputProvider } =
  await import('../src/batch/provider')

beforeEach(() => {
  clientState.claudeOptions = []
  clientState.codexOptions = []
})

test('createBatchStructuredOutputProvider forwards model, effort, and timeout to agent clients', () => {
  createBatchStructuredOutputProvider({
    effort: 'high',
    model: 'gpt-5-codex',
    provider: 'codex',
    timeout: 600000,
    workspaceRoot: '/tmp/workspace',
  } as never)
  createBatchStructuredOutputProvider({
    effort: 'max',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    timeout: 300000,
    workspaceRoot: '/tmp/workspace',
  } as never)

  expect(clientState.codexOptions).toEqual([
    {
      effort: 'high',
      model: 'gpt-5-codex',
      timeout: 600000,
      workspaceRoot: '/tmp/workspace',
    },
  ])
  expect(clientState.claudeOptions).toEqual([
    {
      effort: 'max',
      model: 'claude-sonnet-4-6',
      timeout: 300000,
      workspaceRoot: '/tmp/workspace',
    },
  ])
})
