import { describe, expect, test } from 'vitest'

import { createInMemoryHarnessStore } from '../src/harness/in-memory-store'
import { errorRetry, KernelResultKind, runKernel } from '../src/harness/kernel'
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

describe('kernel-next runKernel retry and restore paths', () => {
  const protocol = 'test-protocol'
  const subjectId = 'subject-1'
  const config = {}

  test('action error routes through transition table when error rule exists', async () => {
    let attempts = 0
    const program = createWorkflowProgram(
      [
        actionNode('work', async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('transient')
          }
          return { result: { kind: 'work.done' } }
        }),
      ],
      {
        work: {
          [KernelResultKind.Error]: errorRetry(5)('work'),
          'work.done': { nextPhase: null, status: TaskStatus.Done },
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
    expect(attempts).toBe(3)

    const state = await store.loadState(protocol, subjectId)
    expect(state!.failureReason).toBe('transient')
  })

  test('action error blocks when no error rule defined', async () => {
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
    expect((await store.loadState(protocol, subjectId))!.failureReason).toBe(
      'boom',
    )
  })

  test('dynamic transition rule receives state and result', async () => {
    const program = createWorkflowProgram(
      [actionNode('work', async () => ({ result: { kind: 'work.done' } }))],
      {
        work: {
          'work.done': (input) => {
            if (input.state.iteration >= 1) {
              return { nextPhase: null, status: TaskStatus.Blocked }
            }
            return { nextPhase: 'work', status: TaskStatus.Running }
          },
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
  })

  test('restores artifacts using state.artifacts references, not list order', async () => {
    const store = createInMemoryHarnessStore()

    await store.saveArtifact(protocol, subjectId, {
      id: 'review-new',
      kind: 'review',
      payload: { verdict: 'approved' },
      subjectId,
      timestamp: '2024-01-02T00:00:00Z',
    })
    await store.saveArtifact(protocol, subjectId, {
      id: 'review-old',
      kind: 'review',
      payload: { verdict: 'rejected' },
      subjectId,
      timestamp: '2024-01-01T00:00:00Z',
    })

    const suspended = createInitialState()
    suspended.status = TaskStatus.Suspended
    suspended.currentPhase = 'resume'
    suspended.artifacts = { review: 'review-new' }
    await store.saveState(protocol, subjectId, suspended)

    const seen: unknown[] = []
    const program = createWorkflowProgram(
      [
        actionNode('resume', async (ctx) => {
          seen.push(ctx.artifacts.get('review')?.payload)
          return { result: { kind: 'resume.done' } }
        }),
      ],
      {
        resume: {
          'resume.done': { nextPhase: null, status: TaskStatus.Done },
        },
      },
    )

    await runKernel({ config, program, protocol, store, subjectId })

    expect(seen[0]).toEqual({ verdict: 'approved' })
  })

  test('custom transition rules can share a retry budget through phaseIterations', async () => {
    let implementCount = 0
    let verifyCount = 0

    const program = createWorkflowProgram(
      [
        actionNode('implement', async () => {
          implementCount++
          return { result: { kind: 'impl.done' } }
        }),
        actionNode('verify', async () => {
          verifyCount++
          return { result: { kind: 'verify.failed' } }
        }),
      ],
      {
        implement: {
          'impl.done': { nextPhase: 'verify', status: TaskStatus.Running },
        },
        verify: {
          'verify.failed': (input) =>
            (input.state.phaseIterations.implement ?? 0) >= 2
              ? { nextPhase: null, status: TaskStatus.Blocked }
              : { nextPhase: 'implement', status: TaskStatus.Running },
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
    expect(implementCount).toBe(2)
    expect(verifyCount).toBe(2)
  })

  test('suspended transition returns suspended status', async () => {
    const program = createWorkflowProgram(
      [
        actionNode('prepare', async () => ({
          result: { kind: 'prepare.done' },
        })),
        actionNode('wait-for-review', async () => ({
          result: { kind: 'wait.done' },
        })),
      ],
      {
        prepare: {
          'prepare.done': {
            nextPhase: 'wait-for-review',
            status: TaskStatus.Suspended,
          },
        },
        'wait-for-review': {
          'wait.done': { nextPhase: null, status: TaskStatus.Done },
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

    expect(result.status).toBe(TaskStatus.Suspended)

    const state = await store.loadState(protocol, subjectId)
    expect(state!.currentPhase).toBe('wait-for-review')
  })
})
