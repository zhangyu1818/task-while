import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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
    public constructor(options: CodexAgentClientOptions) {
      clientState.codexOptions.push(options)
    }

    public async invokeStructured(input: {
      outputSchema: Record<string, unknown>
      prompt: string
    }) {
      clientState.codexInvocations.push(input)
      return { ok: true }
    }
  },
}))

vi.mock('../src/agents/claude', () => ({
  ClaudeAgentClient: class {
    public constructor(options: ClaudeAgentClientOptions) {
      clientState.claudeOptions.push(options)
    }

    public async invokeStructured(input: {
      outputSchema: Record<string, unknown>
      prompt: string
    }) {
      clientState.claudeInvocations.push(input)
      return { ok: true }
    }
  },
}))

const batchProviderModule = await import('../src/batch/provider')
const { createBatchStructuredOutputProvider } = batchProviderModule
const workspaces: string[] = []

type ProviderName = 'claude' | 'codex'

function createBatchConfig(
  provider: ProviderName,
  options: {
    effort?: string
    model?: string
    timeout?: number
  } = {},
) {
  return [
    `provider: ${provider}`,
    ...(options.model ? [`model: ${options.model}`] : []),
    ...(options.effort ? [`effort: ${options.effort}`] : []),
    ...(options.timeout ? [`timeout: ${options.timeout}`] : []),
    'glob:',
    '  - "input/*.txt"',
    'prompt: |',
    '  summarize file',
    'schema:',
    '  type: object',
    '  properties:',
    '    summary:',
    '      type: string',
    '  required:',
    '    - summary',
  ]
}

async function createBatchCommandFixture(
  provider: ProviderName,
  options: {
    effort?: string
    model?: string
    timeout?: number
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-provider-'))
  workspaces.push(root)
  const inputDir = path.join(root, 'input')
  const configPath = path.join(root, 'batch.yaml')

  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(
    configPath,
    [...createBatchConfig(provider, options), ''].join('\n'),
  )

  return { configPath, root }
}

function createProvider(name: ProviderName) {
  return {
    name,
    async runFile() {
      return { summary: 'a.txt' }
    },
  }
}

beforeEach(() => {
  clientState.claudeInvocations = []
  clientState.claudeOptions = []
  clientState.codexInvocations = []
  clientState.codexOptions = []
  eventLogState.claudeHandler.mockClear()
  eventLogState.codexHandler.mockClear()
  eventLogState.createClaudeEventHandler.mockClear()
  eventLogState.createCodexEventHandler.mockClear()
  vi.restoreAllMocks()
})

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

test('createBatchStructuredOutputProvider reuses verbose event handlers and omits them otherwise', () => {
  createBatchStructuredOutputProvider({
    provider: 'codex',
    verbose: true,
    workspaceRoot: '/tmp/workspace',
  })
  createBatchStructuredOutputProvider({
    provider: 'claude',
    verbose: true,
    workspaceRoot: '/tmp/workspace',
  })
  createBatchStructuredOutputProvider({
    provider: 'codex',
    verbose: false,
    workspaceRoot: '/tmp/workspace',
  })
  createBatchStructuredOutputProvider({
    provider: 'claude',
    verbose: false,
    workspaceRoot: '/tmp/workspace',
  })

  expect(eventLogState.createCodexEventHandler).toHaveBeenNthCalledWith(1, true)
  expect(eventLogState.createClaudeEventHandler).toHaveBeenNthCalledWith(
    1,
    true,
  )
  expect(eventLogState.createCodexEventHandler).toHaveBeenNthCalledWith(
    2,
    false,
  )
  expect(eventLogState.createClaudeEventHandler).toHaveBeenNthCalledWith(
    2,
    false,
  )
  expect(clientState.codexOptions).toEqual([
    {
      onEvent: eventLogState.codexHandler,
      workspaceRoot: '/tmp/workspace',
    },
    {
      workspaceRoot: '/tmp/workspace',
    },
  ])
  expect(clientState.claudeOptions).toEqual([
    {
      onEvent: eventLogState.claudeHandler,
      workspaceRoot: '/tmp/workspace',
    },
    {
      workspaceRoot: '/tmp/workspace',
    },
  ])
})

test('runFile builds the structured prompt from the relative path and content', async () => {
  const provider = createBatchStructuredOutputProvider({
    provider: 'codex',
    workspaceRoot: '/tmp/workspace',
  })

  await provider.runFile({
    content: 'alpha\n',
    filePath: 'src/a.ts',
    outputSchema: { type: 'object' },
    prompt: 'summarize file',
  })

  const invocation = clientState.codexInvocations.at(-1)

  expect(invocation?.prompt).toContain(
    'Process exactly one file and return structured output only.',
  )
  expect(invocation?.prompt).toContain('File path: src/a.ts')
  expect(invocation?.prompt).toContain('File content:\n\nalpha\n')
})

test('runBatchCommand forwards verbose to the batch provider factory', async () => {
  const { runBatchCommand } = await import('../src/commands/batch')
  const codexFixture = await createBatchCommandFixture('codex')
  const claudeFixture = await createBatchCommandFixture('claude')
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValueOnce(createProvider('codex'))
    .mockReturnValueOnce(createProvider('claude'))

  await runBatchCommand({
    configPath: codexFixture.configPath,
    cwd: codexFixture.root,
    verbose: true,
  })
  await runBatchCommand({
    configPath: claudeFixture.configPath,
    cwd: claudeFixture.root,
    verbose: false,
  })

  expect(createProviderSpy).toHaveBeenNthCalledWith(1, {
    provider: 'codex',
    verbose: true,
    workspaceRoot: codexFixture.root,
  })
  expect(createProviderSpy).toHaveBeenNthCalledWith(2, {
    provider: 'claude',
    verbose: false,
    workspaceRoot: claudeFixture.root,
  })
})

test('runBatchCommand forwards configured model and effort to the batch provider factory', async () => {
  const { runBatchCommand } = await import('../src/commands/batch')
  const codexFixture = await createBatchCommandFixture('codex', {
    effort: 'high',
    model: 'gpt-5-codex',
  })
  const claudeFixture = await createBatchCommandFixture('claude', {
    effort: 'max',
    model: 'claude-sonnet-4-6',
  })
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValueOnce(createProvider('codex'))
    .mockReturnValueOnce(createProvider('claude'))

  await runBatchCommand({
    configPath: codexFixture.configPath,
    cwd: codexFixture.root,
  })
  await runBatchCommand({
    configPath: claudeFixture.configPath,
    cwd: claudeFixture.root,
  })

  expect(createProviderSpy).toHaveBeenNthCalledWith(1, {
    effort: 'high',
    model: 'gpt-5-codex',
    provider: 'codex',
    workspaceRoot: codexFixture.root,
  })
  expect(createProviderSpy).toHaveBeenNthCalledWith(2, {
    effort: 'max',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    workspaceRoot: claudeFixture.root,
  })
})
