import { describe, expect, test, vi } from 'vitest'

import { TaskStatus, type Artifact, type TaskState } from '../src/harness/state'
import {
  WorkflowNodeType,
  type ActionNode,
  type DomainResult,
  type TransitionRule,
  type TypedArtifactMap,
  type WorkflowNode,
} from '../src/harness/workflow-program'
import {
  BatchArtifactKind,
  BatchPhase,
  BatchResult,
  createBatchProgram,
} from '../src/programs/batch'

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    artifacts: {},
    completedAt: null,
    currentPhase: null,
    failureReason: null,
    iteration: 1,
    phaseIterations: {},
    status: TaskStatus.Running,
    ...overrides,
  }
}

function resolveRule(
  rule: TransitionRule,
  state: TaskState,
  result: DomainResult = { kind: '' },
) {
  return typeof rule === 'function' ? rule({ result, state }) : rule
}

function expectActionNode(node: undefined | WorkflowNode): ActionNode {
  expect(node?.type).toBe(WorkflowNodeType.Action)
  if (node?.type !== WorkflowNodeType.Action) {
    throw new Error(`Expected action node, got ${node?.type ?? 'undefined'}`)
  }
  return node
}

function buildProgram(maxRetries = 3) {
  return createBatchProgram({
    configDir: '/tmp',
    maxRetries,
    outputSchema: {},
    prompt: 'test',
    provider: {} as never,
    results: {},
    resultsPath: '/tmp/results.json',
    validateOutput() {},
  })
}

describe('batch program', () => {
  test('entry is BatchPhase.Prepare', () => {
    const program = buildProgram()
    expect(program.entry).toBe(BatchPhase.Prepare)
  })

  test('ProcessCompleted advances to persist', () => {
    const program = buildProgram()
    const rule =
      program.transitions[BatchPhase.Process]![BatchResult.ProcessCompleted]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: BatchPhase.Persist,
      status: TaskStatus.Running,
    })
  })

  test('ProcessRetryRequested suspends under budget', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[BatchPhase.Process]![
        BatchResult.ProcessRetryRequested
      ]!
    const transition = resolveRule(rule, makeState({ iteration: 1 }))
    expect(transition).toStrictEqual({
      nextPhase: BatchPhase.Process,
      status: TaskStatus.Suspended,
    })
  })

  test('ProcessRetryRequested blocks when budget exhausted', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[BatchPhase.Process]![
        BatchResult.ProcessRetryRequested
      ]!
    const transition = resolveRule(rule, makeState({ iteration: 3 }))
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('PersistCompleted finishes program', () => {
    const program = buildProgram()
    const rule =
      program.transitions[BatchPhase.Persist]![BatchResult.PersistCompleted]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Done,
    })
  })

  test('Process action converts validation errors into retry request', async () => {
    const validateOutput = vi.fn(() => {
      throw new Error('schema mismatch')
    })
    const provider = {
      name: 'codex',
      runFile: vi.fn(async () => ({ wrong: true })),
    }
    const program = createBatchProgram({
      configDir: '/tmp',
      maxRetries: 3,
      outputSchema: {},
      prompt: 'test',
      provider,
      results: {},
      resultsPath: '/tmp/results.json',
      validateOutput,
    })

    const node = expectActionNode(program.nodes[BatchPhase.Process])

    const prepareArtifact = {
      id: 'prepare',
      kind: BatchArtifactKind.PrepareResult,
      payload: { content: 'alpha', filePath: 'input/a.txt' },
      subjectId: 'input/a.txt',
      timestamp: '2026-04-10T00:00:00.000Z',
    } satisfies Artifact<{ content: string; filePath: string }>
    const artifacts: TypedArtifactMap = {
      get: <T = unknown>() => prepareArtifact as Artifact<T>,
      has: () => true,
      set() {},
    }
    const result = await node.run({
      artifacts,
      config: {},
      state: makeState(),
      subjectId: 'input/a.txt',
    })

    expect(provider.runFile).toHaveBeenCalledOnce()
    expect(validateOutput).toHaveBeenCalledWith({ wrong: true })
    expect(result).toStrictEqual({
      result: { kind: BatchResult.ProcessRetryRequested },
    })
  })
})
