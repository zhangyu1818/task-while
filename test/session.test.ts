import { describe, expect, test } from 'vitest'

import { TaskStatus } from '../src/harness/state'
import { runSession, SessionEventType } from '../src/session/session'

import type { KernelResult } from '../src/harness/kernel'
import type { ScheduledSubject, Scheduler } from '../src/schedulers/scheduler'

function createMockScheduler(subjects: ScheduledSubject[]): Scheduler {
  const queue = [...subjects]
  const done = new Set<string>()
  const blocked = new Set<string>()
  const suspended = new Set<string>()

  return {
    async markBlocked(subjectId: string) {
      blocked.add(subjectId)
    },
    async markDone(subjectId: string) {
      done.add(subjectId)
    },
    async markSuspended(subjectId: string) {
      suspended.add(subjectId)
      queue.push({ resumeFromSuspended: true, subjectId })
    },
    async next() {
      if (queue.length === 0) {
        return null
      }
      return queue.shift()!
    },
    async rebuild() {
      return {
        blocked: new Set<string>(),
        done: new Set<string>(),
        replan: new Set<string>(),
        suspended: new Set<string>(),
      }
    },
  }
}

function createMockKernel(results: Record<string, KernelResult>): {
  run: (subjectId: string) => Promise<KernelResult>
} {
  return {
    async run(subjectId: string) {
      return results[subjectId] ?? { status: TaskStatus.Done }
    },
  }
}

async function collectEvents(gen: AsyncGenerator<{ type: string }>) {
  const events: { type: string }[] = []
  for await (const event of gen) {
    events.push(event)
  }
  return events
}

describe('runSession', () => {
  test('runs scheduler to completion and emits done event', async () => {
    const scheduler = createMockScheduler([
      { subjectId: 'a' },
      { subjectId: 'b' },
    ])
    const kernel = createMockKernel({
      a: { status: TaskStatus.Done },
      b: { status: TaskStatus.Done },
    })

    const events = await collectEvents(
      runSession({ config: {}, kernel, scheduler }),
    )

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      SessionEventType.SessionStarted,
      SessionEventType.SubjectStarted,
      SessionEventType.SubjectDone,
      SessionEventType.SubjectStarted,
      SessionEventType.SubjectDone,
      SessionEventType.SessionDone,
    ])
  })

  test('emits subject.blocked when kernel returns blocked', async () => {
    const scheduler = createMockScheduler([{ subjectId: 'a' }])
    const kernel = createMockKernel({
      a: { status: TaskStatus.Blocked },
    })

    const events = await collectEvents(
      runSession({ config: {}, kernel, scheduler }),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain(SessionEventType.SubjectBlocked)
    expect(types).toContain(SessionEventType.SessionDone)
  })

  test('emits subject.resumed for suspended subjects', async () => {
    let callCount = 0
    const scheduler = createMockScheduler([{ subjectId: 'a' }])
    const kernel = {
      async run(subjectId: string): Promise<KernelResult> {
        expect(subjectId).toBe('a')
        callCount++
        if (callCount === 1) {
          return { status: TaskStatus.Suspended }
        }
        return { status: TaskStatus.Done }
      },
    }

    const events = await collectEvents(
      runSession({ config: {}, kernel, scheduler }),
    )

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      SessionEventType.SessionStarted,
      SessionEventType.SubjectStarted,
      SessionEventType.SubjectSuspended,
      SessionEventType.SubjectResumed,
      SessionEventType.SubjectDone,
      SessionEventType.SessionDone,
    ])
  })
})
