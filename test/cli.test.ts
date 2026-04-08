import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { execa } from 'execa'
import { expect, test } from 'vitest'

const cliEntry = fileURLToPath(
  new URL('../bin/task-while.mjs', import.meta.url),
)
const codexSdkHook = fileURLToPath(
  new URL('../fixtures/smoke/mock-codex-sdk-hook.mjs', import.meta.url),
)

async function createWorkspace() {
  return createWorkspaceWithOptions()
}

async function createWorkspaceWithOptions(
  options: { omitFeatureFiles?: string[] } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-cli-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'parser.ts'),
    'export const value = 1\n',
  )
  if (!options.omitFeatureFiles?.includes('spec.md')) {
    await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  }
  if (!options.omitFeatureFiles?.includes('plan.md')) {
    await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  }
  if (!options.omitFeatureFiles?.includes('tasks.md')) {
    await writeFile(
      path.join(featureDir, 'tasks.md'),
      `
# Tasks

## Phase 1: Setup

- [ ] T001 Create parser in src/parser.ts
`,
    )
  }
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await execa('git', ['init'], { cwd: root })
  await execa('git', ['config', 'user.name', 'While Test'], {
    cwd: root,
  })
  await execa('git', ['config', 'user.email', 'while@example.com'], {
    cwd: root,
  })
  await execa('git', ['add', '.'], { cwd: root })
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: root })
  return { featureDir, root }
}

function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return execa(process.execPath, [cliEntry, ...args], {
    cwd,
    reject: false,
    env: {
      ...process.env,
      ...env,
    },
  }).then((result) => ({
    code: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
  }))
}

test('task-while rejects unknown commands', async () => {
  const { root } = await createWorkspace()
  const result = await runCli(['unknown', '--feature', '001-demo'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/unknown command/i)
})

test('task-while rejects rewind as an unknown command', async () => {
  const { root } = await createWorkspace()
  const result = await runCli(['rewind', '--task', 'T001'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/unknown command: rewind/i)
})

test('task-while rejects nested cwd values that do not contain specs directly', async () => {
  const { root } = await createWorkspace()

  const result = await runCli(
    ['run', '--feature', '001-demo'],
    path.join(root, 'src'),
  )

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/current working directory.*specs/i)
})

test('task-while run rejects features missing plan.md', async () => {
  const { root } = await createWorkspaceWithOptions({
    omitFeatureFiles: ['plan.md'],
  })

  const result = await runCli(['run', '--feature', '001-demo'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/001-demo.*plan\.md/i)
})

test('task-while batch does not require specs directory and exits cleanly when glob matches nothing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-cli-'))
  await writeFile(
    path.join(root, 'batch.yaml'),
    [
      'provider: codex',
      'glob: "missing/**/*.txt"',
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

  const result = await runCli(['batch', '--config', './batch.yaml'], root)

  expect(result.code).toBe(0)
  expect(result.stderr).not.toMatch(/specs/i)
  expect(result.stdout).toContain('processedFiles: []')
})

test('task-while batch smoke runs through the real CLI and writes state and results beside batch.yaml', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-cli-smoke-'))
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(
    path.join(root, 'src', 'nested', 'b.ts'),
    'export const b = 2\n',
  )
  await writeFile(
    path.join(root, 'batch.yaml'),
    [
      'provider: codex',
      'glob:',
      '  - "src/**/*.ts"',
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

  const existingNodeOptions = process.env.NODE_OPTIONS
  const nodeOptions = existingNodeOptions
    ? `${existingNodeOptions} --import=${codexSdkHook}`
    : `--import=${codexSdkHook}`
  const result = await runCli(['batch', '--config', './batch.yaml'], root, {
    NODE_OPTIONS: nodeOptions,
  })

  expect(result.code).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain(
    "processedFiles: [ 'src/a.ts', 'src/nested/b.ts' ]",
  )

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
    'src/a.ts': { summary: 'processed:src/a.ts' },
    'src/nested/b.ts': { summary: 'processed:src/nested/b.ts' },
  })
})

test('task-while batch --verbose smoke streams codex agent events to stderr through the real CLI', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-cli-verbose-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'verbose.ts'),
    'export const verbose = true\n',
  )
  await writeFile(
    path.join(root, 'batch.yaml'),
    [
      'provider: codex',
      'glob:',
      '  - "src/**/*.ts"',
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

  const existingNodeOptions = process.env.NODE_OPTIONS
  const nodeOptions = existingNodeOptions
    ? `${existingNodeOptions} --import=${codexSdkHook}`
    : `--import=${codexSdkHook}`
  const result = await runCli(
    ['batch', '--config', './batch.yaml', '--verbose'],
    root,
    {
      NODE_OPTIONS: nodeOptions,
    },
  )

  expect(result.code).toBe(0)
  expect(result.stderr).toContain('[codex] thread.started')
  expect(result.stderr).toContain('[codex] turn.started')
  expect(result.stderr).toContain('[codex] item.completed agent_message')
  expect(result.stderr).toContain(
    '[codex] message {"summary":"processed:src/verbose.ts"}',
  )

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
    'src/verbose.ts': { summary: 'processed:src/verbose.ts' },
  })
})
