import { describe, expect, test } from 'vitest'

import { createInitialState, TaskStatus } from '../src/harness/state'

describe('state types', () => {
  test('initial state is queued with no phase', () => {
    const state = createInitialState()
    expect(state).toStrictEqual({
      artifacts: {},
      completedAt: null,
      currentPhase: null,
      failureReason: null,
      iteration: 0,
      phaseIterations: {},
      status: TaskStatus.Queued,
    })
  })

  test('TaskStatus enum values match expected strings', () => {
    expect(TaskStatus.Queued).toBe('queued')
    expect(TaskStatus.Running).toBe('running')
    expect(TaskStatus.Blocked).toBe('blocked')
    expect(TaskStatus.Done).toBe('done')
    expect(TaskStatus.Suspended).toBe('suspended')
  })
})
