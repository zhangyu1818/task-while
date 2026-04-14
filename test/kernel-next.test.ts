import { describe, expect, test } from 'vitest'

import { createInMemoryHarnessStore } from '../src/harness/in-memory-store'
import { runKernel } from '../src/harness/kernel'
import { createInitialState, TaskStatus } from '../src/harness/state'
import {
  createWorkflowProgram,
  type ActionNode,
} from '../src/harness/workflow-program'

function actionNode(name: string, run: ActionNode['run']): ActionNode {
  return {
    name,
    run,
  }
}

describe('kernel-next runKernel', () => {
  const protocol = 'test-protocol'
  const subjectId = 'subject-1'
  const config = {}

  test('runs a single-action program to completion', async () => {
    const program = createWorkflowProgram(
      [
        actionNode('generate', async () => ({
          result: { kind: 'contract.generated' },
          artifact: {
            id: 'art-1',
            kind: 'contract',
            payload: { spec: true },
            subjectId,
            timestamp: new Date().toISOString(),
          },
        })),
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
    const program = createWorkflowProgram(
      [
        actionNode('a', async () => {
          executed.push('a')
          return { result: { kind: 'a.done' } }
        }),
        actionNode('b', async () => {
          executed.push('b')
          return { result: { kind: 'b.done' } }
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
    const program = createWorkflowProgram(
      [
        actionNode('a', async () => {
          executed.push('a')
          return { result: { kind: 'a.done' } }
        }),
      ],
      {
        a: { 'a.done': { nextPhase: null, status: TaskStatus.Done } },
      },
    )

    const store = createInMemoryHarnessStore()
    const doneState = createInitialState()
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
    const program = createWorkflowProgram(
      [
        actionNode('plan', async () => {
          executed.push('plan')
          return { result: { kind: 'plan.done' } }
        }),
        actionNode('review', async () => {
          executed.push('review')
          return { result: { kind: 'review.done' } }
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
    const suspended = createInitialState()
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

  test('branches through action result kinds instead of dedicated gate nodes', async () => {
    const executed: string[] = []
    const program = createWorkflowProgram(
      [
        actionNode('check', async () => ({ result: { kind: 'check.no' } })),
        actionNode('yes-action', async () => {
          executed.push('yes-action')
          return { result: { kind: 'yes.done' } }
        }),
        actionNode('no-action', async () => {
          executed.push('no-action')
          return { result: { kind: 'no.done' } }
        }),
      ],
      {
        check: {
          'check.no': { nextPhase: 'no-action', status: TaskStatus.Running },
          'check.yes': { nextPhase: 'yes-action', status: TaskStatus.Running },
        },
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
    const program = createWorkflowProgram(
      [
        actionNode('fail', async () => {
          throw new Error('boom')
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
