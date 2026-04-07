import { beforeEach, expect, test, vi } from 'vitest'

import {
  createOrchestratorRuntimeStub,
  createTaskSourceSessionStub,
} from './orchestrator-runtime-test-helpers'

import type { ClaudeAgentClientOptions } from '../src/agents/claude'
import type { CodexAgentClientOptions } from '../src/agents/codex'
import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'
import type { TaskGraph, WorkspaceContext } from '../src/types'
import type {
  WorkflowConfig,
  WorkflowProvider,
  WorkflowRoleConfig,
} from '../src/workflow/config'

interface MockCodexInstance {
  options: CodexAgentClientOptions
}

interface MockClaudeInstance {
  options: ClaudeAgentClientOptions
}

function createMockProvider(
  name: string,
): ImplementerProvider & ReviewerProvider {
  return {
    name,
    async implement() {
      return {
        assumptions: [],
        needsHumanAttention: false,
        notes: [],
        status: 'implemented' as const,
        summary: 'unused',
        taskHandle: 'T001',
        unresolvedItems: [],
      }
    },
    async review() {
      return {
        findings: [],
        overallRisk: 'low' as const,
        summary: 'unused',
        taskHandle: 'T001',
        verdict: 'pass' as const,
        acceptanceChecks: [
          { criterion: 'unused', note: 'unused', status: 'pass' as const },
        ],
      }
    },
  }
}

const createWorkflowRoleConfig = (
  provider: WorkflowProvider = 'codex',
): WorkflowRoleConfig => ({ provider })
const createCodexRole = (
  model: string,
  effort: CodexAgentClientOptions['effort'],
): WorkflowRoleConfig => ({ effort, model, provider: 'codex' })

function createConfig(input?: {
  implementer?: WorkflowProvider
  implementerRole?: WorkflowRoleConfig
  mode?: WorkflowConfig['workflow']['mode']
  reviewer?: WorkflowProvider
  reviewerRole?: WorkflowRoleConfig
}): WorkflowConfig {
  return {
    task: { maxIterations: 5, source: 'spec-kit' },
    workflow: {
      mode: input?.mode ?? 'direct',
      roles: {
        implementer:
          input?.implementerRole ??
          createWorkflowRoleConfig(input?.implementer ?? 'codex'),
        reviewer:
          input?.reviewerRole ??
          createWorkflowRoleConfig(input?.reviewer ?? 'codex'),
      },
    },
  }
}

const mockState = (() => {
  const taskSource = createTaskSourceSessionStub({
    applyTaskCompletion: vi.fn(async () => {}),
    buildCommitSubject: vi.fn(() => 'Task T001: Demo'),
    getCompletionCriteria: vi.fn(async () => []),
    getTaskDependencies: vi.fn(() => []),
    isTaskCompleted: vi.fn(async () => false),
    listTasks: vi.fn(() => []),
    resolveTaskSelector: vi.fn((selector: string) => selector),
    revertTaskCompletion: vi.fn(async () => {}),
    buildImplementPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
    buildReviewPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
  })
  const runtime = createOrchestratorRuntimeStub({
    taskSource,
    git: {
      requireCleanWorktree: vi.fn(async () => {}),
    },
  })
  return {
    claudeInstances: [] as MockClaudeInstance[],
    codexInstances: [] as MockCodexInstance[],
    config: createConfig(),
    openTaskSourceCalls: [] as unknown[],
    runtime,
    runWorkflowCalls: [] as unknown[],
    taskSource,
    workflowConfigCalls: [] as string[],
    workflowConfigError: null as Error | null,
    graph: {
      featureId: '001-demo',
      maxIterations: 5,
      tasks: [],
    } as TaskGraph,
  }
})()

vi.mock('../src/workflow/config', () => ({
  loadWorkflowConfig: vi.fn(async (workspaceRoot: string) => {
    mockState.workflowConfigCalls.push(workspaceRoot)
    if (mockState.workflowConfigError) {
      throw mockState.workflowConfigError
    }
    return mockState.config
  }),
}))
vi.mock('../src/agents/codex', () => ({
  createCodexProvider: vi.fn((options: CodexAgentClientOptions) => {
    mockState.codexInstances.push({ options })
    return createMockProvider('codex')
  }),
}))
vi.mock('../src/agents/claude', () => ({
  createClaudeProvider: vi.fn((options: ClaudeAgentClientOptions) => {
    mockState.claudeInstances.push({ options })
    return createMockProvider('claude')
  }),
}))
vi.mock('../src/task-sources/registry', () => ({
  openTaskSource: vi.fn(async (...args: unknown[]) => {
    mockState.openTaskSourceCalls.push(args)
    return mockState.taskSource
  }),
}))
vi.mock('../src/core/task-topology', () => ({
  buildTaskTopology: vi.fn(() => mockState.graph),
}))
vi.mock('../src/runtime/fs-runtime', () => ({
  createOrchestratorRuntime: vi.fn(() => mockState.runtime),
}))
vi.mock('../src/core/orchestrator', () => ({
  runWorkflow: vi.fn(async (input) => {
    mockState.runWorkflowCalls.push(input)
    return {
      state: { currentTaskHandle: null, featureId: '001-demo', tasks: {} },
      summary: {
        blockedTasks: 0,
        completedTasks: 0,
        finalStatus: 'in_progress',
        replanTasks: 0,
        totalTasks: 0,
      },
    }
  }),
}))

const { loadWorkflowExecution } = await import('../src/commands/run')

function createContext(): WorkspaceContext {
  return {
    featureDir: '/tmp/specs/001-demo',
    featureId: '001-demo',
    runtimeDir: '/tmp/specs/001-demo/.while',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.claudeInstances = []
  mockState.codexInstances = []
  mockState.config = createConfig()
  mockState.openTaskSourceCalls = []
  mockState.runWorkflowCalls = []
  mockState.workflowConfigError = null
  mockState.workflowConfigCalls = []
})

test('loadWorkflowExecution forwards matching direct role options to a shared local provider', async () => {
  const context = createContext()
  mockState.config = createConfig({
    implementerRole: createCodexRole('gpt-5-codex', 'high'),
    reviewerRole: createCodexRole('gpt-5-codex', 'high'),
  })

  const execution = await loadWorkflowExecution(context)

  expect(mockState.codexInstances).toHaveLength(1)
  expect(mockState.codexInstances[0]?.options).toMatchObject({
    effort: 'high',
    model: 'gpt-5-codex',
    workspaceRoot: '/tmp',
  })
  expect(execution.workflow.roles.implementer).toBe(
    execution.workflow.roles.reviewer,
  )
})

test('loadWorkflowExecution rejects conflicting direct role options on a shared provider', async () => {
  const context = createContext()
  mockState.config = createConfig({
    implementerRole: createCodexRole('gpt-5-codex', 'medium'),
    reviewerRole: createCodexRole('gpt-5-codex', 'high'),
  })

  await expect(loadWorkflowExecution(context)).rejects.toThrow(
    /direct workflow roles implementer and reviewer must use matching model and effort when sharing provider codex/i,
  )

  expect(mockState.claudeInstances).toHaveLength(0)
  expect(mockState.codexInstances).toHaveLength(0)
})

test('loadWorkflowExecution ignores reviewer model and effort overrides in pull-request mode', async () => {
  const context = createContext()
  mockState.config = createConfig({
    mode: 'pull-request',
    reviewerRole: createCodexRole('reviewer-override', 'high'),
    implementerRole: {
      effort: 'max',
      model: 'claude-implementer',
      provider: 'claude',
    },
  })

  const execution = await loadWorkflowExecution(context)

  expect(mockState.claudeInstances).toHaveLength(1)
  expect(mockState.claudeInstances[0]?.options).toMatchObject({
    effort: 'max',
    model: 'claude-implementer',
    workspaceRoot: '/tmp',
  })
  expect(mockState.codexInstances).toHaveLength(0)
  expect(execution.workflow).toMatchObject({
    preset: { mode: 'pull-request' },
    roles: {
      implementer: expect.objectContaining({ name: 'claude' }),
      reviewer: expect.objectContaining({ name: 'codex' }),
    },
  })
})

test('loadWorkflowExecution rejects unsupported remote reviewers in pull-request mode', async () => {
  const context = createContext()
  mockState.config = createConfig({
    mode: 'pull-request',
    reviewer: 'claude',
  })

  await expect(loadWorkflowExecution(context)).rejects.toThrow(
    /claude remote reviewer is not implemented in pull-request mode/i,
  )

  expect(mockState.claudeInstances).toHaveLength(0)
  expect(mockState.codexInstances).toHaveLength(0)
})
test('loadWorkflowExecution returns an executable plan with resolved config', async () => {
  const context = createContext()

  const execution = await loadWorkflowExecution(context, {
    untilTaskId: 'T003',
  })

  expect(execution.config).toEqual(mockState.config)
  expect(execution.workflow).toMatchObject({
    preset: { mode: 'direct' },
    roles: {
      implementer: expect.objectContaining({ name: 'codex' }),
      reviewer: expect.objectContaining({ name: 'codex' }),
    },
  })

  await execution.execute()

  expect(mockState.runWorkflowCalls[0]).toMatchObject({
    graph: mockState.graph,
    runtime: mockState.runtime,
    untilTaskHandle: 'T003',
    workflow: execution.workflow,
  })
  expect(mockState.runWorkflowCalls[0]).not.toHaveProperty('agent')
})
test('loadWorkflowExecution reuses preloaded config without re-reading while.yaml', async () => {
  const context = createContext()
  const config = createConfig()
  config.task.source = 'openspec'

  await loadWorkflowExecution(context, {
    config,
  })

  expect(mockState.workflowConfigCalls).toEqual([])
  expect(mockState.openTaskSourceCalls).toEqual([
    [
      'openspec',
      {
        featureDir: '/tmp/specs/001-demo',
        featureId: '001-demo',
        workspaceRoot: '/tmp',
      },
    ],
  ])
})
