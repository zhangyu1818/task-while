import { describe, expect, test } from 'vitest'

import { KernelResultKind } from '../src/harness/kernel'
import { TaskStatus, type TaskState } from '../src/harness/state'
import {
  createRunDirectProgram,
  RunPhase,
  RunResult,
} from '../src/programs/run-direct'

import type {
  DomainResult,
  TransitionRule,
} from '../src/harness/workflow-program'
import type { AgentPort } from '../src/ports/agent'

function stubAgent(name: string): AgentPort {
  return {
    name,
    execute: async () => ({}),
  }
}

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
  return createRunDirectProgram({
    implementer: stubAgent('impl'),
    maxIterations,
    reviewer: stubAgent('rev'),
    verifyCommands: ['echo ok'],
    workspaceRoot: '/tmp',
    ports: {
      git: {} as never,
      taskSource: {} as never,
    },
  })
}

describe('run-direct program', () => {
  test('entry is RunPhase.Contract', () => {
    const program = buildProgram()
    expect(program.entry).toBe(RunPhase.Contract)
  })

  test('ContractGenerated transitions to implement', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Contract]![RunResult.ContractGenerated]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: RunPhase.Implement,
      status: TaskStatus.Running,
    })
  })

  test('ReviewRejected loops back to implement under task budget', () => {
    const program = buildProgram(5)
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

  test('VerifyFailed loops back to implement under task budget', () => {
    const program = buildProgram(5)
    const rule = program.transitions[RunPhase.Verify]![RunResult.VerifyFailed]!
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

  test('IntegrateCompleted finishes program', () => {
    const program = buildProgram()
    const rule =
      program.transitions[RunPhase.Integrate]![RunResult.IntegrateCompleted]!
    const transition = resolveRule(rule, makeState())
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Done,
    })
  })

  test('action error retries under budget', () => {
    const program = buildProgram(3)
    for (const phase of [
      RunPhase.Contract,
      RunPhase.Implement,
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
      program.transitions[RunPhase.Integrate]![KernelResultKind.Error]!
    const transition = resolveRule(
      rule,
      makeState({
        phaseIterations: {
          [RunPhase.Contract]: 3,
          [RunPhase.Integrate]: 1,
        },
      }),
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
    const transition = resolveRule(rule, makeState({ iteration: 1 }))
    expect(transition).toStrictEqual({
      nextPhase: null,
      status: TaskStatus.Replan,
    })
  })
})
