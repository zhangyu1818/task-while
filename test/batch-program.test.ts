import { describe, expect, test } from 'vitest'

import { TaskStatus, type TaskState } from '../src/harness/state'
import {
  BatchPhase,
  BatchResult,
  createBatchProgram,
} from '../src/programs/batch'

import type {
  DomainResult,
  TransitionRule,
} from '../src/harness/workflow-program'

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

function buildProgram(maxRetries = 3) {
  return createBatchProgram({
    configDir: '/tmp',
    maxRetries,
    outputSchema: {},
    prompt: 'test',
    provider: {} as never,
    results: {},
    resultsPath: '/tmp/results.json',
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
})
