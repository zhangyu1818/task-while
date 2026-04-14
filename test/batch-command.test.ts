import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { AgentInvocation, AgentPort } from '../src/ports/agent'

const agentState = vi.hoisted(() => ({
  agent: null as AgentPort | null,
  invocations: [] as AgentInvocation[],
  createAgentPort: vi.fn(() => {
    if (!agentState.agent) {
      throw new Error('Missing batch agent')
    }
    return agentState.agent
  }),
}))

vi.mock('../src/ports/agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ports/agent')>()
  return {
    ...original,
    createAgentPort: agentState.createAgentPort,
  }
})

const { runBatchCommand } = await import('../src/commands/batch')

const workspaces: string[] = []

function extractFilePath(prompt: string) {
  const match = prompt.match(/File path: (.+)(?:\n|$)/)
  return match?.[1] ?? ''
}

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-command-'))
  workspaces.push(root)
  return root
}

async function writeConfig(
  root: string,
  globLines: string[] = ['input/*.txt'],
  configDir = root,
) {
  const configPath = path.join(configDir, 'batch.yaml')
  await mkdir(configDir, { recursive: true })
  await writeFile(
    configPath,
    [
      'provider: codex',
      'glob:',
      ...globLines.map((pattern) => `  - "${pattern}"`),
      'prompt: |',
      '  summarize file',
      'schema:',
      '  type: object',
      '  properties:',
      '    summary:',
      '      type: string',
      '  required:',
      '    - summary',
      '',
    ].join('\n'),
  )
  return configPath
}

async function readBatchResults<T>(root: string) {
  return JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, T>
}

async function writeBatchResults<T>(root: string, results: Record<string, T>) {
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(results, null, 2),
  )
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

beforeEach(() => {
  agentState.agent = null
  agentState.createAgentPort.mockClear()
  agentState.invocations = []
  vi.restoreAllMocks()
})

test('runBatchCommand writes results for discovered files', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return {
        summary: path.basename(extractFilePath(invocation.prompt)),
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(
    agentState.invocations.map((input) => extractFilePath(input.prompt)).sort(),
  ).toEqual(['input/a.txt', 'input/b.txt'])

  const results = await readBatchResults<{ summary: string }>(root)

  expect(results).toEqual({
    'input/a.txt': { summary: 'a.txt' },
    'input/b.txt': { summary: 'b.txt' },
  })
})

test('runBatchCommand skips completed results on rerun', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  await writeFile(path.join(inputDir, 'c.txt'), 'gamma\n')
  const configPath = await writeConfig(root)
  await writeBatchResults(root, {
    'input/a.txt': {
      summary: 'done',
    },
  })

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return {
        summary: extractFilePath(invocation.prompt),
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(
    agentState.invocations.map((input) => extractFilePath(input.prompt)).sort(),
  ).toEqual(['input/b.txt', 'input/c.txt'])

  const results = await readBatchResults<{ summary: string }>(root)

  expect(results).toEqual({
    'input/a.txt': { summary: 'done' },
    'input/b.txt': { summary: 'input/b.txt' },
    'input/c.txt': { summary: 'input/c.txt' },
  })
})

test('runBatchCommand retries files that fail validation until they succeed', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)
  let attemptCount = 0

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      if (
        extractFilePath(invocation.prompt) === 'input/a.txt' &&
        attemptCount === 0
      ) {
        attemptCount += 1
        throw new Error('transient failure')
      }
      return {
        summary: extractFilePath(invocation.prompt),
      }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(result.failedFiles).toEqual([])
  expect(result.processedFiles.sort()).toEqual(['input/a.txt', 'input/b.txt'])

  const results = await readBatchResults<unknown>(root)
  expect(results).toEqual({
    'input/a.txt': { summary: 'input/a.txt' },
    'input/b.txt': { summary: 'input/b.txt' },
  })
})

test('runBatchCommand resolves glob and result keys relative to the batch.yaml directory', async () => {
  const root = await createWorkspace()
  const configDir = path.join(root, 'config')
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root, ['../input/*.txt'], configDir)

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return {
        summary: extractFilePath(invocation.prompt),
      }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(
    agentState.invocations.map((input) => extractFilePath(input.prompt)),
  ).toEqual(['../input/a.txt'])
  expect(result.results).toEqual({
    '../input/a.txt': {
      summary: '../input/a.txt',
    },
  })
})

test('runBatchCommand completes cleanly when glob matches nothing', async () => {
  const root = await createWorkspace()
  const configPath = await writeConfig(root, ['missing/**/*.txt'])

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return { summary: extractFilePath(invocation.prompt) }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(result.processedFiles).toEqual([])
  expect(result.results).toEqual({})
  expect(result.failedFiles).toEqual([])
  expect(agentState.createAgentPort).not.toHaveBeenCalled()
})

test('runBatchCommand --verbose prints outer batch progress', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return {
        summary: extractFilePath(invocation.prompt),
      }
    },
  }

  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true)

  await runBatchCommand({
    configPath,
    cwd: root,
    verbose: true,
  })

  const output = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join('')

  expect(output).toContain(
    '[batch] resume total=2 completed=0 blocked=0 suspended=0\n',
  )
  expect(output).toContain('[batch] start completed=0/2 file=input/a.txt\n')
  expect(output).toContain('[batch] done completed=1/2 file=input/a.txt\n')
  expect(output).toContain('[batch] start completed=1/2 file=input/b.txt\n')
  expect(output).toContain('[batch] done completed=2/2 file=input/b.txt\n')
})
