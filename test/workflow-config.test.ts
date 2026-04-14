import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { loadWorkflowConfig } from '../src/workflow/config'

const workspaces: string[] = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'while-workflow-config-'),
  )
  workspaces.push(workspaceRoot)
  return workspaceRoot
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(async (workspaceRoot) =>
        rm(workspaceRoot, { force: true, recursive: true }),
      ),
  )
})

test('loadWorkflowConfig defaults to direct codex roles when while.yaml is absent', async () => {
  const workspaceRoot = await createWorkspace()

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    task: {
      maxIterations: 5,
      source: 'spec-kit',
    },
    verify: {
      commands: [],
    },
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'codex' },
      },
    },
  })
})

test('loadWorkflowConfig parses configured role providers from yaml mappings', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer: { provider: claude }',
      '    reviewer: { provider: codex }',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    task: {
      maxIterations: 5,
      source: 'spec-kit',
    },
    verify: {
      commands: [],
    },
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'claude' },
        reviewer: { provider: 'codex' },
      },
    },
  })
})

test('loadWorkflowConfig parses pull-request mode without rewriting it to direct', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  mode: pull-request',
      '  roles:',
      '    implementer: { provider: codex }',
      '    reviewer: { provider: claude }',
      'task:',
      '  maxIterations: 7',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    task: {
      maxIterations: 7,
      source: 'spec-kit',
    },
    verify: {
      commands: [],
    },
    workflow: {
      mode: 'pull-request',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'claude' },
      },
    },
  })
})

test('loadWorkflowConfig parses model and effort for codex and claude roles', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '      model: o4-mini',
      '      effort: medium',
      '    reviewer:',
      '      provider: claude',
      '      model: claude-sonnet-4-6',
      '      effort: high',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config.workflow.roles).toEqual({
    implementer: {
      effort: 'medium',
      model: 'o4-mini',
      provider: 'codex',
    },
    reviewer: {
      effort: 'high',
      model: 'claude-sonnet-4-6',
      provider: 'claude',
    },
  })
})

test('loadWorkflowConfig parses optional timeout values for workflow roles', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '      timeout: 900000',
      '    reviewer:',
      '      provider: claude',
      '      timeout: 300000',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config.workflow.roles).toEqual({
    implementer: {
      provider: 'codex',
      timeout: 900000,
    },
    reviewer: {
      provider: 'claude',
      timeout: 300000,
    },
  })
})

test('loadWorkflowConfig rejects timeout values above the node timer limit', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '      timeout: 2147483648',
      '',
    ].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(/timeout/i)
})

test('loadWorkflowConfig defaults provider to codex when a role only configures model or effort', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      model: o4-mini',
      '      effort: medium',
      '    reviewer:',
      '      effort: high',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config.workflow.roles).toEqual({
    implementer: {
      effort: 'medium',
      model: 'o4-mini',
      provider: 'codex',
    },
    reviewer: {
      effort: 'high',
      provider: 'codex',
    },
  })
})

test('loadWorkflowConfig rejects unsupported effort values and empty model strings', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '      effort: max',
      '',
    ].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(/effort/i)
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '      model: "   "',
      '',
    ].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(/model/i)
})

test('loadWorkflowConfig parses built-in task sources and rejects unknown ones', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    ['task:', '  source: openspec', ''].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    task: {
      maxIterations: 5,
      source: 'openspec',
    },
    verify: {
      commands: [],
    },
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'codex' },
      },
    },
  })

  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    ['task:', '  source: custom-source', ''].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(
    /spec-kit|openspec/i,
  )
})

test('loadWorkflowConfig rejects unknown keys instead of silently defaulting', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      proivder: claude',
      '',
    ].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(
    /proivder|unrecognized|discriminator/i,
  )
})

test('loadWorkflowConfig reads verify.commands from yaml and defaults to empty array', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'verify:',
      '  commands:',
      '    - pnpm lint:fix',
      '    - pnpm test',
      '',
    ].join('\n'),
  )
  const config = await loadWorkflowConfig(workspaceRoot)
  expect(config.verify).toEqual({ commands: ['pnpm lint:fix', 'pnpm test'] })
  const defaultConfig = await loadWorkflowConfig(await createWorkspace())
  expect(defaultConfig.verify).toEqual({ commands: [] })
})
