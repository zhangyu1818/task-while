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

interface PersistedBatchState {
  failed: string[]
  inProgress: string[]
  pending: string[]
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

async function readBatchState(root: string) {
  return JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8'),
  ) as PersistedBatchState
}

async function readBatchResults<T>(root: string) {
  return JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, T>
}

async function writeBatchState(root: string, state: PersistedBatchState) {
  await writeFile(path.join(root, 'state.json'), JSON.stringify(state, null, 2))
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
})

test('runBatchCommand writes results and state for discovered files', async () => {
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

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'input/a.txt',
    'input/b.txt',
  ])

  const state = await readBatchState(root)
  const results = await readBatchResults<{ summary: string }>(root)

  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(results).toEqual({
    'input/a.txt': { summary: 'a.txt' },
    'input/b.txt': { summary: 'b.txt' },
  })
})

test('runBatchCommand restores inProgress files and skips completed results on rerun', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  await writeFile(path.join(inputDir, 'c.txt'), 'gamma\n')
  const configPath = await writeConfig(root)
  await writeBatchState(root, {
    failed: [],
    inProgress: ['input/b.txt'],
    pending: ['input/c.txt'],
  })
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

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'input/b.txt',
    'input/c.txt',
  ])

  const state = await readBatchState(root)
  const results = await readBatchResults<{ summary: string }>(root)

  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(results).toEqual({
    'input/a.txt': { summary: 'done' },
    'input/b.txt': { summary: 'input/b.txt' },
    'input/c.txt': { summary: 'input/c.txt' },
  })
})

test('runBatchCommand recycles failed files into the next round until they succeed', async () => {
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
        return {
          wrong: true,
        }
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

  const state = await readBatchState(root)
  const results = await readBatchResults<unknown>(root)

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'input/a.txt',
    'input/b.txt',
    'input/a.txt',
  ])
  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(result.failedFiles).toEqual([])
  expect(results).toEqual({
    'input/a.txt': { summary: 'input/a.txt' },
    'input/b.txt': { summary: 'input/b.txt' },
  })
})

test('runBatchCommand persists recycled failed files as the next runnable queue', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  await writeBatchState(root, {
    failed: ['input/a.txt'],
    inProgress: [],
    pending: [],
  })

  let observedState: null | PersistedBatchState = null

  providerState.provider = {
    name: 'codex',
    async runFile() {
      observedState = await readBatchState(root)
      return {
        summary: 'a.txt',
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(observedState).toEqual({
    failed: [],
    inProgress: ['input/a.txt'],
    pending: [],
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

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(result.processedFiles).toEqual([])
  expect(result.results).toEqual({})
  expect(result.state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
})
