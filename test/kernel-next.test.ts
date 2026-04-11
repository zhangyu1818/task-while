import { describe, expect, test } from 'vitest'

import { createInMemoryHarnessStore } from '../src/harness/in-memory-store'
import { runKernel } from '../src/harness/kernel'
import { createInitialState, TaskStatus } from '../src/harness/state'
import { action, gate, sequence } from '../src/harness/workflow-builders'

describe('kernel-next runKernel', () => {
  const protocol = 'test-protocol'
  const subjectId = 'subject-1'
  const config = {}

  test('runs a single-action program to completion', async () => {
    const program = sequence(
      [
        action('generate', {
          run: async () => ({
            result: { kind: 'contract.generated' },
            artifact: {
              id: 'art-1',
              kind: 'contract',
              payload: { spec: true },
              subjectId,
              timestamp: new Date().toISOString(),
            },
          }),
        }),
      ],
      {
        generate: {
          'contract.generated': { nextPhase: null, status: TaskStatus.Done },
        },
      },
    )

    const store = createInMemoryHarnessStore()
    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Done)

    const state = await store.loadState(protocol, subjectId)
    expect(state).not.toBeNull()
    expect(state!.completedAt).toBeTruthy()
    expect(state!.artifacts.contract).toBe('art-1')
  })

  test('runs a multi-phase program with transitions', async () => {
    const executed: string[] = []
    const program = sequence(
      [
        action('a', {
          async run() {
            executed.push('a')
            return { result: { kind: 'a.done' } }
          },
        }),
        action('b', {
          async run() {
            executed.push('b')
            return { result: { kind: 'b.done' } }
          },
        }),
      ],
      {
        a: { 'a.done': { nextPhase: 'b', status: TaskStatus.Running } },
        b: { 'b.done': { nextPhase: null, status: TaskStatus.Done } },
      },
    )

    const store = createInMemoryHarnessStore()
    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Done)
    expect(executed).toEqual(['a', 'b'])
  })

  test('returns immediately when state is already done', async () => {
    const executed: string[] = []
    const program = sequence(
      [
        action('a', {
          async run() {
            executed.push('a')
            return { result: { kind: 'a.done' } }
          },
        }),
      ],
      {
        a: { 'a.done': { nextPhase: null, status: TaskStatus.Done } },
      },
    )

    const store = createInMemoryHarnessStore()
    const doneState = createInitialState(subjectId)
    doneState.status = TaskStatus.Done
    doneState.completedAt = new Date().toISOString()
    await store.saveState(protocol, subjectId, doneState)

    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Done)
    expect(executed).toEqual([])
  })

  test('resumes from suspended state', async () => {
    const executed: string[] = []
    const program = sequence(
      [
        action('plan', {
          async run() {
            executed.push('plan')
            return { result: { kind: 'plan.done' } }
          },
        }),
        action('review', {
          async run() {
            executed.push('review')
            return { result: { kind: 'review.done' } }
          },
        }),
      ],
      {
        review: { 'review.done': { nextPhase: null, status: TaskStatus.Done } },
        plan: {
          'plan.done': { nextPhase: 'review', status: TaskStatus.Running },
        },
      },
    )

    const store = createInMemoryHarnessStore()
    const suspended = createInitialState(subjectId)
    suspended.status = TaskStatus.Suspended
    suspended.currentPhase = 'review'
    await store.saveState(protocol, subjectId, suspended)

    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Done)
    expect(executed).toEqual(['review'])
  })

  test('gate evaluates and skips to correct branch', async () => {
    const executed: string[] = []
    const program = sequence(
      [
        gate('check', {
          otherwise: 'no-action',
          then: 'yes-action',
          test: async () => false,
        }),
        action('yes-action', {
          async run() {
            executed.push('yes-action')
            return { result: { kind: 'yes.done' } }
          },
        }),
        action('no-action', {
          async run() {
            executed.push('no-action')
            return { result: { kind: 'no.done' } }
          },
        }),
      ],
      {
        'no-action': {
          'no.done': { nextPhase: null, status: TaskStatus.Done },
        },
        'yes-action': {
          'yes.done': { nextPhase: null, status: TaskStatus.Done },
        },
      },
    )

    const store = createInMemoryHarnessStore()
    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Done)
    expect(executed).toEqual(['no-action'])
  })

  test('action error sets state to blocked', async () => {
    const program = sequence(
      [
        action('fail', {
          async run() {
            throw new Error('boom')
          },
        }),
      ],
      {
        fail: {
          'fail.completed': { nextPhase: null, status: TaskStatus.Done },
        },
      },
    )

    const store = createInMemoryHarnessStore()
    const result = await runKernel({
      config,
      program,
      protocol,
      store,
      subjectId,
    })

    expect(result.status).toBe(TaskStatus.Blocked)

    const state = await store.loadState(protocol, subjectId)
    expect(state!.failureReason).toBe('boom')
  })
})
