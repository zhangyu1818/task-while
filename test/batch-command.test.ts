import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type {
  BatchFileInput,
  BatchStructuredOutputProvider,
} from '../src/batch/provider'

const providerState = vi.hoisted(() => ({
  inputs: [] as BatchFileInput[],
  provider: null as BatchStructuredOutputProvider | null,
}))

vi.mock('../src/batch/provider', () => {
  return {
    createBatchStructuredOutputProvider: vi.fn(() => {
      if (!providerState.provider) {
        throw new Error('Missing batch structured output provider')
      }
      return providerState.provider
    }),
  }
})

const { runBatchCommand } = await import('../src/commands/batch')

const workspaces: string[] = []

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
  providerState.inputs = []
  providerState.provider = null
  vi.restoreAllMocks()
})

test('runBatchCommand writes results for discovered files', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: path.basename(input.filePath),
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath).sort()).toEqual([
    'input/a.txt',
    'input/b.txt',
  ])

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

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: input.filePath,
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath).sort()).toEqual([
    'input/b.txt',
    'input/c.txt',
  ])

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

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      if (input.filePath === 'input/a.txt' && attemptCount === 0) {
        attemptCount += 1
        throw new Error('transient failure')
      }
      return {
        summary: input.filePath,
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

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: input.filePath,
      }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    '../input/a.txt',
  ])
  expect(result.results).toEqual({
    '../input/a.txt': {
      summary: '../input/a.txt',
    },
  })
})

test('runBatchCommand completes cleanly when glob matches nothing', async () => {
  const root = await createWorkspace()
  const configPath = await writeConfig(root, ['missing/**/*.txt'])

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return { summary: input.filePath }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(result.processedFiles).toEqual([])
  expect(result.results).toEqual({})
  expect(result.failedFiles).toEqual([])
})

test('runBatchCommand --verbose prints outer batch progress', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: input.filePath,
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
