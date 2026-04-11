import { describe, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  configError: null as Error | null,
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
    getTaskDependencies: () => [],
    isTaskCompleted: async () => false,
    listTasks: () => [],
    resolveTaskSelector: (s: string) => s,
    async revertTaskCompletion() {},
  })),
}))

vi.mock('../src/core/create-runtime-ports', () => ({
  createRuntimePorts: vi.fn(() => ({
    codeHost: {},
    git: {
      getChangedFilesSinceHead: vi.fn(async () => []),
      getCurrentBranch: vi.fn(async () => 'main'),
      requireCleanWorktree: vi.fn(async () => {}),
    },
    resolveAgent: vi.fn(() => ({
      name: 'mock',
      execute: vi.fn(async () => ({})),
    })),
    taskSource: {
      async applyTaskCompletion() {},
      buildCommitSubject: () => 'Task T001',
      buildImplementPrompt: async () => ({ instructions: [], sections: [] }),
      buildReviewPrompt: async () => ({ instructions: [], sections: [] }),
      getCompletionCriteria: async () => [],
      getTaskDependencies: () => [],
      isTaskCompleted: async () => false,
      listTasks: () => [],
      resolveTaskSelector: (s: string) => s,
      async revertTaskCompletion() {},
    },
  })),
}))

vi.mock('../src/core/task-topology', () => ({
  buildTaskTopology: vi.fn(() => ({
    featureId: 'test',
    maxIterations: 5,
    tasks: [],
  })),
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

describe('run command guards', () => {
  test('short-circuits when workflow config loading fails', async () => {
    mockState.configError = new Error('bad config')

    await expect(runCommand(createContext())).rejects.toThrow('bad config')

    mockState.configError = null
  })

  test('rejects conflicting direct role options on a shared provider', async () => {
    mockState.configError = null

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

  test('rejects claude remote reviewer in pull-request mode', async () => {
    mockState.configError = null

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
})
