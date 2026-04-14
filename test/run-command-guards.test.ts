import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  configError: null as Error | null,
  requireCleanWorktree: vi.fn(async () => {}),
  taskHandles: [] as string[],
  createAgentPort: vi.fn(() => ({
    name: 'mock',
    execute: vi.fn(async () => ({})),
  })),
}))

vi.mock('../src/workflow/config', () => ({
  loadWorkflowConfig: vi.fn(async () => {
    if (mockState.configError) {
      throw mockState.configError
    }
    return {
      task: { maxIterations: 5, source: 'spec-kit' },
      verify: { commands: [] },
      workflow: {
        mode: 'direct',
        roles: {
          implementer: { provider: 'codex' },
          reviewer: { provider: 'codex' },
        },
      },
    }
  }),
}))

vi.mock('../src/task-sources/registry', () => ({
  openTaskSource: vi.fn(async () => ({
    async applyTaskCompletion() {},
    buildCommitSubject: () => 'Task T001',
    buildImplementPrompt: async () => ({ instructions: [], sections: [] }),
    buildReviewPrompt: async () => ({ instructions: [], sections: [] }),
    getCompletionCriteria: async () => [],
    isTaskCompleted: async () => false,
    listTasks: () => mockState.taskHandles,
    resolveTaskSelector: (s: string) => s,
    async revertTaskCompletion() {},
  })),
}))

vi.mock('../src/ports/agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ports/agent')>()
  return {
    ...original,
    createAgentPort: mockState.createAgentPort,
  }
})

vi.mock('../src/runtime/git', () => ({
  GitRuntime: class {
    public requireCleanWorktree = mockState.requireCleanWorktree
  },
}))

vi.mock('../src/runtime/github', () => ({
  GitHubRuntime: class {
    public readonly name = 'mock-github'
  },
}))

const { runCommand } = await import('../src/commands/run')

function createContext() {
  return {
    featureDir: '/tmp/test',
    featureId: 'test',
    runtimeDir: '/tmp/test/.while',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.configError = null
  mockState.createAgentPort.mockClear()
  mockState.requireCleanWorktree.mockClear()
  mockState.taskHandles = []
})

describe('run command guards', () => {
  test('short-circuits when workflow config loading fails', async () => {
    mockState.configError = new Error('bad config')

    await expect(runCommand(createContext())).rejects.toThrow('bad config')
  })

  test('rejects conflicting direct role options on a shared provider', async () => {
    await expect(
      runCommand(createContext(), {
        config: {
          task: { maxIterations: 5, source: 'spec-kit' },
          verify: { commands: [] },
          workflow: {
            mode: 'direct',
            roles: {
              reviewer: { effort: 'low', model: 'gpt-5', provider: 'codex' },
              implementer: {
                effort: 'high',
                model: 'gpt-5',
                provider: 'codex',
              },
            },
          },
        },
      }),
    ).rejects.toThrow(
      /direct workflow roles implementer and reviewer must use matching/,
    )
  })

  test('rejects timeout mismatches on a shared direct provider', async () => {
    await expect(
      runCommand(createContext(), {
        config: {
          task: { maxIterations: 5, source: 'spec-kit' },
          verify: { commands: [] },
          workflow: {
            mode: 'direct',
            roles: {
              implementer: {
                effort: 'medium',
                model: 'gpt-5',
                provider: 'codex',
                timeout: 600000,
              },
              reviewer: {
                effort: 'medium',
                model: 'gpt-5',
                provider: 'codex',
                timeout: 300000,
              },
            },
          },
        },
      }),
    ).rejects.toThrow(/matching model, effort, and timeout/i)
  })

  test('rejects claude remote reviewer in pull-request mode', async () => {
    await expect(
      runCommand(createContext(), {
        config: {
          task: { maxIterations: 5, source: 'spec-kit' },
          verify: { commands: [] },
          workflow: {
            mode: 'pull-request',
            roles: {
              implementer: { provider: 'codex' },
              reviewer: { provider: 'claude' },
            },
          },
        },
      }),
    ).rejects.toThrow(/claude remote reviewer is not implemented/)
  })

  test('rejects duplicate task handles from the task source', async () => {
    mockState.taskHandles = ['T001', 'T001']

    await expect(runCommand(createContext())).rejects.toThrow(
      /duplicate task handle/i,
    )
  })

  test('pull-request mode creates only the implementer agent', async () => {
    const result = await runCommand(createContext(), {
      config: {
        task: { maxIterations: 5, source: 'spec-kit' },
        verify: { commands: [] },
        workflow: {
          mode: 'pull-request',
          roles: {
            implementer: { provider: 'codex' },
            reviewer: { provider: 'codex' },
          },
        },
      },
    })

    expect(result.summary.totalTasks).toBe(0)
    expect(mockState.createAgentPort).toHaveBeenCalledTimes(1)
    expect(mockState.createAgentPort).toHaveBeenCalledWith(
      {
        provider: 'codex',
      },
      {
        workspaceRoot: '/tmp',
      },
    )
  })
})
