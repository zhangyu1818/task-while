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

async function writeConfig(root: string) {
  const configPath = path.join(root, 'batch.yaml')
  await writeFile(
    configPath,
    [
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
      '',
    ].join('\n'),
  )
  return configPath
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

test('runBatchCommand prints file failure reasons when verbose is enabled', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  let attemptCount = 0

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      attemptCount += 1
      if (attemptCount === 1) {
        return {
          wrong: true,
        }
      }
      return {
        summary: input.filePath,
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
    verbose: true,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'input/a.txt',
    'input/a.txt',
  ])
  expect(
    stderr.mock.calls.some((call) =>
      /\[batch\] failed input\/a\.txt:/.test(String(call[0])),
    ),
  ).toBe(true)
})

test('runBatchCommand drops missing failed paths before starting a new run', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  await writeFile(
    path.join(root, 'state.json'),
    JSON.stringify(
      {
        failed: ['input/missing.txt'],
        inProgress: [],
        pending: [],
      },
      null,
      2,
    ),
  )

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      if (input.filePath === 'input/a.txt') {
        await writeFile(path.join(inputDir, 'missing.txt'), 'late\n')
      }
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
    'input/a.txt',
  ])

  const state = JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8'),
  ) as {
    failed: string[]
    inProgress: string[]
    pending: string[]
  }
  const results = JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, { summary: string }>

  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(results).toEqual({
    'input/a.txt': { summary: 'input/a.txt' },
  })
})
