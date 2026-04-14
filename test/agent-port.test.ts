import { beforeEach, expect, test, vi } from 'vitest'

import type { ClaudeAgentClientOptions } from '../src/agents/claude'
import type { CodexAgentClientOptions } from '../src/agents/codex'

const clientState = vi.hoisted(() => ({
  claudeOptions: [] as ClaudeAgentClientOptions[],
  codexOptions: [] as CodexAgentClientOptions[],
  claudeInvocations: [] as {
    outputSchema: Record<string, unknown>
    prompt: string
  }[],
  codexInvocations: [] as {
    outputSchema: Record<string, unknown>
    prompt: string
  }[],
}))

const eventLogState = vi.hoisted(() => {
  const claudeHandler = vi.fn()
  const codexHandler = vi.fn()

  return {
    claudeHandler,
    codexHandler,
    createClaudeEventHandler: vi.fn((verbose?: boolean) =>
      verbose ? claudeHandler : undefined,
    ),
    createCodexEventHandler: vi.fn((verbose?: boolean) =>
      verbose ? codexHandler : undefined,
    ),
  }
})

vi.mock('../src/agents/event-log', () => ({
  createClaudeEventHandler: eventLogState.createClaudeEventHandler,
  createCodexEventHandler: eventLogState.createCodexEventHandler,
}))

vi.mock('../src/agents/codex', () => ({
  CodexAgentClient: class {
    public readonly name = 'codex'

    public constructor(options: CodexAgentClientOptions) {
      clientState.codexOptions.push(options)
    }

    public async invokeStructured(input: {
      outputSchema: Record<string, unknown>
      prompt: string
    }) {
      clientState.codexInvocations.push(input)
      return { provider: 'codex' }
    }
  },
}))

vi.mock('../src/agents/claude', () => ({
  ClaudeAgentClient: class {
    public readonly name = 'claude'

    public constructor(options: ClaudeAgentClientOptions) {
      clientState.claudeOptions.push(options)
    }

    public async invokeStructured(input: {
      outputSchema: Record<string, unknown>
      prompt: string
    }) {
      clientState.claudeInvocations.push(input)
      return { provider: 'claude' }
    }
  },
}))

const { createAgentPort } = await import('../src/ports/agent')

beforeEach(() => {
  clientState.claudeInvocations = []
  clientState.claudeOptions = []
  clientState.codexInvocations = []
  clientState.codexOptions = []
  eventLogState.claudeHandler.mockClear()
  eventLogState.codexHandler.mockClear()
  eventLogState.createClaudeEventHandler.mockClear()
  eventLogState.createCodexEventHandler.mockClear()
})

test('createAgentPort forwards provider options and verbose handlers to local clients', () => {
  createAgentPort(
    {
      effort: 'high',
      model: 'gpt-5-codex',
      provider: 'codex',
      timeout: 600000,
    },
    {
      verbose: true,
      workspaceRoot: '/tmp/codex-workspace',
    },
  )
  createAgentPort(
    {
      effort: 'max',
      model: 'claude-sonnet-4-6',
      provider: 'claude',
      timeout: 300000,
    },
    {
      verbose: false,
      workspaceRoot: '/tmp/claude-workspace',
    },
  )

  expect(eventLogState.createCodexEventHandler).toHaveBeenCalledWith(true)
  expect(eventLogState.createClaudeEventHandler).toHaveBeenCalledWith(false)
  expect(clientState.codexOptions).toEqual([
    {
      effort: 'high',
      model: 'gpt-5-codex',
      onEvent: eventLogState.codexHandler,
      timeout: 600000,
      workspaceRoot: '/tmp/codex-workspace',
    },
  ])
  expect(clientState.claudeOptions).toEqual([
    {
      effort: 'max',
      model: 'claude-sonnet-4-6',
      timeout: 300000,
      workspaceRoot: '/tmp/claude-workspace',
    },
  ])
})

test('agent execute delegates prompt and output schema to the selected client', async () => {
  const codexAgent = createAgentPort(
    {
      provider: 'codex',
    },
    {
      workspaceRoot: '/tmp/workspace',
    },
  )
  const claudeAgent = createAgentPort(
    {
      provider: 'claude',
    },
    {
      workspaceRoot: '/tmp/workspace',
    },
  )

  await expect(
    codexAgent.execute({
      outputSchema: { type: 'object' },
      prompt: 'codex prompt',
    }),
  ).resolves.toEqual({ provider: 'codex' })
  await expect(
    claudeAgent.execute({
      outputSchema: { type: 'object' },
      prompt: 'claude prompt',
    }),
  ).resolves.toEqual({ provider: 'claude' })

  expect(clientState.codexInvocations).toEqual([
    {
      outputSchema: { type: 'object' },
      prompt: 'codex prompt',
    },
  ])
  expect(clientState.claudeInvocations).toEqual([
    {
      outputSchema: { type: 'object' },
      prompt: 'claude prompt',
    },
  ])
})
