import { beforeEach, expect, test, vi } from 'vitest'

import { createRuntimePorts } from '../src/core/create-runtime-ports'

const mockState = vi.hoisted(() => ({
  claudeProviders: [] as unknown[],
  codexProviders: [] as unknown[],
}))

vi.mock('../src/agents/claude', () => ({
  createClaudeProvider: vi.fn((options: unknown) => {
    mockState.claudeProviders.push(options)
    return {
      name: 'claude',
      invokeStructured: vi.fn(),
      review: vi.fn(),
    }
  }),
}))

vi.mock('../src/agents/codex', () => ({
  createCodexProvider: vi.fn((options: unknown) => {
    mockState.codexProviders.push(options)
    return {
      name: 'codex',
      invokeStructured: vi.fn(),
      review: vi.fn(),
    }
  }),
}))

vi.mock('../src/runtime/git', () => ({
  GitRuntime: function MockGitRuntime(this: unknown) {},
}))

vi.mock('../src/runtime/github', () => ({
  GitHubRuntime: function MockGitHubRuntime(this: unknown) {},
}))

beforeEach(() => {
  mockState.claudeProviders = []
  mockState.codexProviders = []
})

test('createRuntimePorts keeps separate codex providers when only timeout differs', () => {
  const ports = createRuntimePorts({
    config: {
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
    },
    context: {
      featureDir: '/tmp/feature',
      featureId: 'demo',
      runtimeDir: '/tmp/feature/.while',
      workspaceRoot: '/tmp/workspace',
    },
    taskSource: {
      applyTaskCompletion: vi.fn(),
      createTaskPrompt: vi.fn(),
      getTaskGraph: vi.fn(),
      resolveTaskSelector: vi.fn(),
      sourceName: 'spec-kit',
    } as never,
  })

  const first = ports.resolveAgent({
    model: 'gpt-5-codex',
    provider: 'codex',
    timeout: 300000,
  } as never)
  const second = ports.resolveAgent({
    model: 'gpt-5-codex',
    provider: 'codex',
    timeout: 600000,
  } as never)
  const third = ports.resolveAgent({
    model: 'gpt-5-codex',
    provider: 'codex',
    timeout: 600000,
  } as never)

  expect(first).not.toBe(second)
  expect(second).toBe(third)
  expect(mockState.codexProviders).toHaveLength(2)
})
