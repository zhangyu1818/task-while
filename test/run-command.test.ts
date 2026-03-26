import { beforeEach, expect, test, vi } from 'vitest'

import type { CodexAgentClientOptions } from '../src/agents/codex'
import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'
import type { OrchestratorRuntime } from '../src/core/runtime'
import type { TaskGraph, WorkspaceContext } from '../src/types'
import type {
  WorkflowConfig,
  WorkflowProvider,
  WorkflowRoleConfig,
} from '../src/workflow/config'

interface MockCodexInstance {
  options: CodexAgentClientOptions
  provider: ImplementerProvider & ReviewerProvider
}

function createWorkflowRoleConfig(
  provider: WorkflowProvider = 'codex',
): WorkflowRoleConfig {
  return {
    provider,
  }
}

const mockState = vi.hoisted(() => {
  return {
    callSequence: [] as string[],
    codexInstances: [] as MockCodexInstance[],
    runWorkflowCalls: [] as unknown[],
    workflowConfigCalls: [] as string[],
    workflowConfigError: null as Error | null,
    config: {
      workflow: {
        mode: 'direct',
        roles: {
          implementer: createWorkflowRoleConfig(),
          reviewer: createWorkflowRoleConfig(),
        },
      },
    } as WorkflowConfig,
    graph: {
      featureId: '001-demo',
      tasks: [],
    } as TaskGraph,
    runtime: {
      store: {},
      workspace: {},
      git: {
        requireCleanWorktree: vi.fn(async () => {}),
      },
    } as unknown as OrchestratorRuntime,
  }
})

vi.mock('../src/workflow/config', () => {
  return {
    loadWorkflowConfig: vi.fn(async (workspaceRoot: string) => {
      mockState.workflowConfigCalls.push(workspaceRoot)
      mockState.callSequence.push('config')
      if (mockState.workflowConfigError) {
        throw mockState.workflowConfigError
      }
      return mockState.config
    }),
  }
})

vi.mock('../src/agents/codex', () => {
  return {
    createCodexProvider: vi.fn((options: CodexAgentClientOptions) => {
      const provider: ImplementerProvider & ReviewerProvider = {
        name: 'codex',
        async implement() {
          return {
            assumptions: [],
            needsHumanAttention: false,
            notes: [],
            status: 'implemented' as const,
            summary: 'unused',
            taskId: 'T001',
            unresolvedItems: [],
          }
        },
        async review() {
          return {
            findings: [],
            overallRisk: 'low' as const,
            summary: 'unused',
            taskId: 'T001',
            verdict: 'pass' as const,
            acceptanceChecks: [
              {
                criterion: 'unused',
                note: 'unused',
                status: 'pass' as const,
              },
            ],
          }
        },
      }
      mockState.codexInstances.push({
        options,
        provider,
      })
      return provider
    }),
  }
})

vi.mock('../src/core/task-normalizer', () => {
  return {
    normalizeTaskGraph: vi.fn(async () => {
      mockState.callSequence.push('graph')
      return mockState.graph
    }),
  }
})

vi.mock('../src/runtime/fs-runtime', () => {
  return {
    createOrchestratorRuntime: vi.fn(() => {
      mockState.callSequence.push('runtime')
      return mockState.runtime
    }),
  }
})

vi.mock('../src/core/orchestrator', () => {
  return {
    runWorkflow: vi.fn(async (input) => {
      mockState.callSequence.push('workflow')
      mockState.runWorkflowCalls.push(input)
      return {
        state: {
          currentTaskId: null,
          featureId: '001-demo',
          tasks: {},
        },
        summary: {
          blockedTasks: 0,
          completedTasks: 0,
          finalStatus: 'in_progress',
          replanTasks: 0,
          totalTasks: 0,
        },
      }
    }),
  }
})

const { runCommand } = await import('../src/commands/run')

function createContext(): WorkspaceContext {
  return {
    featureDir: '/tmp/specs/001-demo',
    featureId: '001-demo',
    planPath: '/tmp/specs/001-demo/plan.md',
    runtimeDir: '/tmp/specs/001-demo/.while',
    specPath: '/tmp/specs/001-demo/spec.md',
    tasksPath: '/tmp/specs/001-demo/tasks.md',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.callSequence = []
  mockState.codexInstances = []
  mockState.config = {
    workflow: {
      mode: 'direct',
      roles: {
        implementer: createWorkflowRoleConfig(),
        reviewer: createWorkflowRoleConfig(),
      },
    },
  }
  mockState.runWorkflowCalls = []
  mockState.workflowConfigError = null
  mockState.workflowConfigCalls = []
})

test('runCommand resolves default Codex workflow and forwards untilTaskId', async () => {
  const context = createContext()

  await runCommand(context, {
    untilTaskId: 'T002',
  })

  expect(mockState.codexInstances).toHaveLength(1)
  expect(mockState.codexInstances[0]?.options.workspaceRoot).toBe('/tmp')
  expect(mockState.codexInstances[0]?.options.onEvent).toBeUndefined()
  expect(mockState.runWorkflowCalls[0]).toMatchObject({
    graph: mockState.graph,
    runtime: mockState.runtime,
    untilTaskId: 'T002',
    workflow: {
      preset: {
        mode: 'direct',
      },
      roles: {
        implementer: expect.objectContaining({ name: 'codex' }),
        reviewer: expect.objectContaining({ name: 'codex' }),
      },
    },
  })
})

test('runCommand enables Codex progress callback on workflow providers when verbose is true', async () => {
  const context = createContext()
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  stderr.mockClear()

  await runCommand(context, {
    verbose: true,
  })

  expect(mockState.codexInstances).toHaveLength(1)
  expect(mockState.codexInstances[0]?.options.onEvent).toBeTypeOf('function')
  mockState.codexInstances[0]?.options.onEvent?.({
    type: 'item.completed',
    item: {
      text: '{"verdict":"pass","acceptanceChecks":[{"status":"fail"}]}',
      type: 'agent_message',
    },
  })
  expect(stderr).toHaveBeenNthCalledWith(
    1,
    '[codex] item.completed agent_message\n',
  )
  expect(stderr).toHaveBeenNthCalledWith(
    2,
    '[codex] message {"verdict":"pass","acceptanceChecks":[{"status":"fail"}]}\n',
  )
})

test('runCommand prints codex error details when verbose is true', async () => {
  const context = createContext()
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  stderr.mockClear()

  await runCommand(context, {
    verbose: true,
  })

  mockState.codexInstances[0]?.options.onEvent?.({
    message: 'bad payload',
    type: 'error',
  })

  expect(stderr).toHaveBeenNthCalledWith(1, '[codex] error\n')
  expect(stderr).toHaveBeenNthCalledWith(2, '[codex] error bad payload\n')
})

test('runCommand loads workflow config before creating runtime', async () => {
  const context = createContext()

  await runCommand(context)

  expect(mockState.workflowConfigCalls).toEqual(['/tmp'])
  expect(mockState.callSequence).toEqual([
    'config',
    'runtime',
    'graph',
    'workflow',
  ])
})

test('runCommand short-circuits when workflow config loading fails', async () => {
  const context = createContext()
  mockState.workflowConfigError = new Error('bad config')

  await expect(runCommand(context)).rejects.toThrow('bad config')

  expect(mockState.callSequence).toEqual(['config'])
  expect(mockState.codexInstances).toHaveLength(0)
  expect(mockState.runWorkflowCalls).toHaveLength(0)
})
