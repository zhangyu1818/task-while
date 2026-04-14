import { TaskStatus } from '../harness/state'

import type { KernelResult } from '../harness/kernel'
import type { Scheduler } from '../schedulers/scheduler'

export enum SessionEventType {
  SessionDone = 'session.done',
  SessionFailed = 'session.failed',
  SessionStarted = 'session.started',
  SubjectBlocked = 'subject.blocked',
  SubjectDone = 'subject.done',
  SubjectResumed = 'subject.resumed',
  SubjectStarted = 'subject.started',
  SubjectSuspended = 'subject.suspended',
}

export interface SessionEvent {
  detail: unknown
  subjectId: string
  timestamp: string
  type: SessionEventType
}

export interface SessionProgress {
  blocked: number
  completed: number
  suspended: number
  total: number
}

export async function* runSession(input: {
  kernel: { run: (subjectId: string) => Promise<KernelResult> }
  scheduler: Scheduler
}): AsyncGenerator<SessionEvent> {
  const { kernel, scheduler } = input

  const sets = await scheduler.rebuild()

  const progress: SessionProgress = {
    blocked: sets.blocked.size,
    completed: sets.done.size,
    suspended: sets.suspended.size,
    total: 0,
  }

  yield {
    detail: { progress },
    subjectId: '',
    timestamp: new Date().toISOString(),
    type: SessionEventType.SessionStarted,
  }

  try {
    for (;;) {
      const scheduled = await scheduler.next()
      if (!scheduled) {
        break
      }

      const { subjectId } = scheduled

      if (scheduled.resumeFromSuspended) {
        yield {
          detail: null,
          subjectId,
          timestamp: new Date().toISOString(),
          type: SessionEventType.SubjectResumed,
        }
      } else {
        yield {
          detail: null,
          subjectId,
          timestamp: new Date().toISOString(),
          type: SessionEventType.SubjectStarted,
        }
      }

      const result: KernelResult = await kernel.run(subjectId)

      if (result.status === TaskStatus.Done) {
        await scheduler.markDone(subjectId)
        yield {
          detail: null,
          subjectId,
          timestamp: new Date().toISOString(),
          type: SessionEventType.SubjectDone,
        }
      } else if (result.status === TaskStatus.Suspended) {
        await scheduler.markSuspended(subjectId)
        yield {
          detail: null,
          subjectId,
          timestamp: new Date().toISOString(),
          type: SessionEventType.SubjectSuspended,
        }
      } else if (
        result.status === TaskStatus.Blocked ||
        result.status === TaskStatus.Replan
      ) {
        await scheduler.markBlocked(subjectId)
        yield {
          detail: null,
          subjectId,
          timestamp: new Date().toISOString(),
          type: SessionEventType.SubjectBlocked,
        }
      }
    }

    yield {
      detail: null,
      subjectId: '',
      timestamp: new Date().toISOString(),
      type: SessionEventType.SessionDone,
    }
  } catch (error) {
    yield {
      detail: { error },
      subjectId: '',
      timestamp: new Date().toISOString(),
      type: SessionEventType.SessionFailed,
    }
    throw error
  }
}
