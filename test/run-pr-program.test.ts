import { describe, expect, test } from 'vitest'

import { KernelResultKind } from '../src/harness/kernel'
import { TaskStatus, type TaskState } from '../src/harness/state'
import { RunPhase, RunResult } from '../src/programs/run-direct'
import { createRunPrProgram } from '../src/programs/run-pr'

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

function buildProgram(maxIterations = 5) {
  return createRunPrProgram({
    implementer: {} as never,
    maxIterations,
    reviewer: {} as never,
    reviewPollIntervalMs: 0,
    verifyCommands: ['echo ok'],
    workspaceRoot: '/tmp',
    ports: {
      codeHost: {} as never,
      git: {} as never,
      taskSource: {} as never,
    },
  })
}

describe('run-pr program', () => {
  test('verify.passed routes to checkpoint', () => {
    const program = buildProgram()
    const rule = program.transitions[RunPhase.Verify]![RunResult.VerifyPassed]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: RunPhase.Checkpoint,
      status: TaskStatus.Running,
    })
  })

  test('review.approved advances to integrate', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Review]![RunResult.ReviewApproved]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: RunPhase.Integrate,
      status: TaskStatus.Running,
    })
  })

  test('integrate.already_integrated marks done', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Integrate]![
        RunResult.IntegrateAlreadyIntegrated
      ]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Done,
    })
  })

  test('ReviewRejected blocks when task budget exhausted', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[RunPhase.Review]![RunResult.ReviewRejected]!
    const transition = resolveRule(
      rule,
      makeState({ phaseIterations: { [RunPhase.Implement]: 3 } }),
    )
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('ReviewRejected loops back under budget', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[RunPhase.Review]![RunResult.ReviewRejected]!
    const transition = resolveRule(
      rule,
      makeState({ phaseIterations: { [RunPhase.Implement]: 2 } }),
    )
    expect(transition).toStrictEqual({
      nextPhase: RunPhase.Implement,
      status: TaskStatus.Running,
    })
  })

  test('VerifyFailed blocks when task budget exhausted', () => {
    const program = buildProgram(3)
    const rule = program.transitions[RunPhase.Verify]![RunResult.VerifyFailed]!
    const transition = resolveRule(
      rule,
      makeState({ phaseIterations: { [RunPhase.Implement]: 3 } }),
    )
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('ReviewReplanRequired uses Replan status', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Review]![RunResult.ReviewReplanRequired]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Replan,
    })
  })

  test('action error retries under budget', () => {
    const program = buildProgram(3)
    for (const phase of [
      RunPhase.Contract,
      RunPhase.Implement,
      RunPhase.Checkpoint,
      RunPhase.Integrate,
    ]) {
      const rule = program.transitions[phase]![KernelResultKind.Error]!
      const transition = resolveRule(
        rule,
        makeState({ phaseIterations: { [phase]: 1 } }),
      )
      expect(transition).toStrictEqual({
        nextPhase: phase,
        status: TaskStatus.Running,
      })
    }
  })

  test('verify/review errors route to implement using task budget', () => {
    const program = buildProgram(3)
    for (const phase of [RunPhase.Verify, RunPhase.Review]) {
      const rule = program.transitions[phase]![KernelResultKind.Error]!
      const transition = resolveRule(
        rule,
        makeState({ phaseIterations: { [RunPhase.Implement]: 1 } }),
      )
      expect(transition).toStrictEqual({
        nextPhase: RunPhase.Implement,
        status: TaskStatus.Running,
      })
    }
  })

  test('action error blocks when budget exhausted', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[RunPhase.Implement]![KernelResultKind.Error]!
    const transition = resolveRule(
      rule,
      makeState({ phaseIterations: { [RunPhase.Implement]: 3 } }),
    )
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('ReviewRejected blocks when another phase already exhausted task budget', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[RunPhase.Review]![RunResult.ReviewRejected]!
    const transition = resolveRule(
      rule,
      makeState({
        phaseIterations: {
          [RunPhase.Contract]: 3,
          [RunPhase.Implement]: 1,
        },
      }),
    )
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('action error blocks when another phase already exhausted task budget', () => {
    const program = buildProgram(3)
    const rule =
      program.transitions[RunPhase.Checkpoint]![KernelResultKind.Error]!
    const transition = resolveRule(
      rule,
      makeState({
        phaseIterations: {
          [RunPhase.Checkpoint]: 1,
          [RunPhase.Implement]: 2,
          [RunPhase.Review]: 3,
        },
      }),
    )
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Blocked,
    })
  })

  test('checkpoint.created routes to review', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Checkpoint]![RunResult.CheckpointCreated]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: RunPhase.Review,
      status: TaskStatus.Running,
    })
  })
})
