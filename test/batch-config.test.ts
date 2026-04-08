import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { loadBatchConfig } from '../src/batch/config'

const workspaces: string[] = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'while-batch-config-'),
  )
  workspaces.push(workspaceRoot)
  return workspaceRoot
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

test('loadBatchConfig defaults glob to **/* and uses the batch.yaml directory as configDir', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
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

  const config = await loadBatchConfig({
    configPath,
    cwd: workspaceRoot,
  })

  expect(config).toMatchObject({
    configDir: workspaceRoot,
    configPath,
    glob: ['**/*'],
    prompt: 'summarize file',
    provider: 'codex',
  })
  expect(config.schema).toMatchObject({
    required: ['summary'],
    type: 'object',
  })
})

test('loadBatchConfig accepts both string and array glob values', async () => {
  const workspaceRoot = await createWorkspace()
  const configDir = path.join(workspaceRoot, 'configs')
  await mkdir(configDir, { recursive: true })
  const configPath = path.join(configDir, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: claude',
      'glob:',
      '  - "../src/**/*.ts"',
      '  - "../src/**/*.tsx"',
      'model: claude-sonnet-4-6',
      'effort: max',
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

  const config = await loadBatchConfig({
    configPath,
    cwd: workspaceRoot,
  })

  expect(config).toMatchObject({
    configDir,
    effort: 'max',
    glob: ['../src/**/*.ts', '../src/**/*.tsx'],
    model: 'claude-sonnet-4-6',
    provider: 'claude',
  })
})

test('loadBatchConfig rejects workdir because batch root now comes from the config file directory', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      'workdir: ./src',
      'prompt: |',
      '  summarize file',
      'schema:',
      '  type: object',
      '',
    ].join('\n'),
  )

  await expect(
    loadBatchConfig({
      configPath,
      cwd: workspaceRoot,
    }),
  ).rejects.toThrow(/workdir/i)
})

test('loadBatchConfig rejects an empty glob string', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      'glob: "   "',
      'prompt: |',
      '  summarize file',
      'schema:',
      '  type: object',
      '',
    ].join('\n'),
  )

  await expect(
    loadBatchConfig({
      configPath,
      cwd: workspaceRoot,
    }),
  ).rejects.toThrow(/glob/i)
})
