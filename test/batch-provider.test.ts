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

async function createBatchCommandFixture(configLines: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-provider-'))
  workspaces.push(root)
  const inputDir = path.join(root, 'input')
  const configPath = path.join(root, 'batch.yaml')

  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(configPath, [...configLines, ''].join('\n'))

  return {
    configPath,
    inputDir,
    root,
  }
}

beforeEach(() => {
  clientState.claudeInvocations = []
  clientState.claudeOptions = []
  clientState.codexInvocations = []
  clientState.codexOptions = []
  vi.restoreAllMocks()
})

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

test('createBatchStructuredOutputProvider forwards model and effort to CodexAgentClient', () => {
  createBatchStructuredOutputProvider({
    effort: 'high',
    model: 'gpt-5-codex',
    provider: 'codex',
    workspaceRoot: '/tmp/workspace',
  } as never)

  expect(clientState.codexOptions).toEqual([
    {
      effort: 'high',
      model: 'gpt-5-codex',
      workspaceRoot: '/tmp/workspace',
    },
  ])
})

test('createBatchStructuredOutputProvider forwards model and effort to ClaudeAgentClient', () => {
  createBatchStructuredOutputProvider({
    effort: 'max',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    workspaceRoot: '/tmp/workspace',
  } as never)

  expect(clientState.claudeOptions).toEqual([
    {
      effort: 'max',
      model: 'claude-sonnet-4-6',
      workspaceRoot: '/tmp/workspace',
    },
  ])
})

test('createBatchStructuredOutputProvider keeps default agent options when model and effort are unset', () => {
  createBatchStructuredOutputProvider({
    provider: 'codex',
    workspaceRoot: '/tmp/workspace',
  })

  expect(clientState.codexOptions).toEqual([
    {
      workspaceRoot: '/tmp/workspace',
    },
  ])
})

test('runFile builds the structured prompt from the config-root-relative file path and content', async () => {
  const provider = createBatchStructuredOutputProvider({
    provider: 'codex',
    workspaceRoot: '/tmp/workspace',
  })

  await provider.runFile({
    content: 'alpha\n',
    filePath: 'src/a.ts',
    prompt: 'summarize file',
    outputSchema: {
      type: 'object',
    },
  })

  const invocation = clientState.codexInvocations.at(-1)

  expect(invocation?.prompt).toContain(
    'Process exactly one file and return structured output only.',
  )
  expect(invocation?.prompt).toContain('File path: src/a.ts')
  expect(invocation?.prompt).toContain('File content:\n\nalpha\n')
  expect(invocation?.prompt).not.toContain('Workdir-relative path:')
})

test('runBatchCommand forwards configured model and effort to the batch provider factory', async () => {
  const { configPath, root } = await createBatchCommandFixture([
    'provider: codex',
    'model: gpt-5-codex',
    'effort: high',
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
  ])
  const provider = {
    name: 'codex',
    async runFile() {
      return {
        summary: 'a.txt',
      }
    },
  }
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValue(provider)

  const { runBatchCommand } = await import('../src/commands/batch')

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(createProviderSpy).toHaveBeenCalledWith({
    effort: 'high',
    model: 'gpt-5-codex',
    provider: 'codex',
    workspaceRoot: root,
  })
})

test('runBatchCommand forwards claude model and effort to the batch provider factory', async () => {
  const { configPath, root } = await createBatchCommandFixture([
    'provider: claude',
    'model: claude-sonnet-4-6',
    'effort: max',
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
  ])
  const provider = {
    name: 'claude',
    async runFile() {
      return {
        summary: 'a.txt',
      }
    },
  }
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValue(provider)
  const { runBatchCommand } = await import('../src/commands/batch')

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(createProviderSpy).toHaveBeenCalledWith({
    effort: 'max',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    workspaceRoot: root,
  })
})

test('runBatchCommand omits model and effort when they are not configured', async () => {
  const { configPath, root } = await createBatchCommandFixture([
    'provider: codex',
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
  ])
  const provider = {
    name: 'codex',
    async runFile() {
      return {
        summary: 'a.txt',
      }
    },
  }
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValue(provider)
  const { runBatchCommand } = await import('../src/commands/batch')

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(createProviderSpy).toHaveBeenCalledWith({
    provider: 'codex',
    workspaceRoot: root,
  })
})

test('runBatchCommand omits model and effort for claude when they are not configured', async () => {
  const { configPath, root } = await createBatchCommandFixture([
    'provider: claude',
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
  ])
  const provider = {
    name: 'claude',
    async runFile() {
      return {
        summary: 'a.txt',
      }
    },
  }
  const createProviderSpy = vi
    .spyOn(batchProviderModule, 'createBatchStructuredOutputProvider')
    .mockReturnValue(provider)
  const { runBatchCommand } = await import('../src/commands/batch')

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(createProviderSpy).toHaveBeenCalledWith({
    provider: 'claude',
    workspaceRoot: root,
  })
})
