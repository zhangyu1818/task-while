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
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-next-'))
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

test('processes discovered files and writes results', async () => {
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
      return { summary: path.basename(input.filePath) }
    },
  }

  const result = await runBatchCommand({ configPath, cwd: root })

  expect(providerState.inputs.map((i) => i.filePath).sort()).toEqual([
    'input/a.txt',
    'input/b.txt',
  ])
  expect(result.processedFiles.sort()).toEqual(['input/a.txt', 'input/b.txt'])
  expect(result.failedFiles).toEqual([])
  expect(result.resultsFilePath).toBe(path.join(root, 'results.json'))

  const results = await readBatchResults<{ summary: string }>(root)
  expect(results).toEqual({
    'input/a.txt': { summary: 'a.txt' },
    'input/b.txt': { summary: 'b.txt' },
  })
})

test('skips files already present in results.json', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ 'input/a.txt': { summary: 'done' } }),
  )

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return { summary: input.filePath }
    },
  }

  const result = await runBatchCommand({ configPath, cwd: root })

  expect(providerState.inputs.map((i) => i.filePath)).toEqual(['input/b.txt'])
  expect(result.processedFiles).toEqual(['input/b.txt'])

  const results = await readBatchResults<{ summary: string }>(root)
  expect(results).toEqual({
    'input/a.txt': { summary: 'done' },
    'input/b.txt': { summary: 'input/b.txt' },
  })
})

test('completes cleanly when glob matches nothing', async () => {
  const root = await createWorkspace()
  const configPath = await writeConfig(root, ['missing/**/*.txt'])

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return { summary: input.filePath }
    },
  }

  const result = await runBatchCommand({ configPath, cwd: root })

  expect(result.processedFiles).toEqual([])
  expect(result.failedFiles).toEqual([])
  expect(result.results).toEqual({})
})

test('resolves glob and result keys relative to batch.yaml directory', async () => {
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
      return { summary: input.filePath }
    },
  }

  const result = await runBatchCommand({ configPath, cwd: root })

  expect(providerState.inputs.map((i) => i.filePath)).toEqual([
    '../input/a.txt',
  ])
  expect(result.results).toEqual({
    '../input/a.txt': { summary: '../input/a.txt' },
  })
})

test('blocks files that permanently fail after retries', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)

  providerState.provider = {
    name: 'codex',
    async runFile() {
      throw new Error('provider error')
    },
  }

  const result = await runBatchCommand({ configPath, cwd: root })

  expect(result.processedFiles).toEqual([])
  expect(result.failedFiles).toEqual(['input/a.txt'])
})
