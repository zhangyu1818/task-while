import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('loadBatchConfig defaults workdir to cwd when omitted', async () => {
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
    configPath,
    outputDir: workspaceRoot,
    prompt: 'summarize file',
    provider: 'codex',
    workdir: workspaceRoot,
  })
  expect('model' in config).toBe(false)
  expect('effort' in config).toBe(false)
  expect(config.schema).toMatchObject({
    required: ['summary'],
    type: 'object',
  })
})

test('loadBatchConfig parses model and effort for claude', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: claude',
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
    effort: 'max',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
  })
})

test('loadBatchConfig rejects provider-specific unsupported effort values', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: claude',
      'effort: xhigh',
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
  ).rejects.toThrow(/effort/i)
})

test('loadBatchConfig rejects an empty model string', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      'model: "   "',
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
  ).rejects.toThrow(/model/i)
})

test('loadBatchConfig rejects missing required fields', async () => {
  const workspaceRoot = await createWorkspace()
  const configPath = path.join(workspaceRoot, 'batch.yaml')
  await writeFile(
    configPath,
    ['provider: codex', 'schema:', '  type: object', ''].join('\n'),
  )

  await expect(
    loadBatchConfig({
      configPath,
      cwd: workspaceRoot,
    }),
  ).rejects.toThrow(/prompt/i)
})
