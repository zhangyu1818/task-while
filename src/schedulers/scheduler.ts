import { TaskStatus } from '../harness/state'

import type { HarnessStore } from '../harness/store'

export interface ScheduledSubject {
  resumeFromSuspended?: boolean
  subjectId: string
}

export interface Scheduler {
  markBlocked: (subjectId: string) => Promise<void>
  markDone: (subjectId: string) => Promise<void>
  markSuspended: (subjectId: string) => Promise<void>
  next: () => Promise<null | ScheduledSubject>
  rebuild: () => Promise<{
    blocked: Set<string>
    done: Set<string>
    replan: Set<string>
    suspended: Set<string>
  }>
}

export function createTaskQueueScheduler(input: {
  protocol: string
  store: HarnessStore
  taskHandles: string[]
  untilTaskHandle?: string
}): Scheduler {
  const done = new Set<string>()
  const blocked = new Set<string>()
  const replan = new Set<string>()
  const suspended = new Set<string>()
  const deferred = new Set<string>()

  return {
    async markBlocked(subjectId: string) {
      deferred.delete(subjectId)
      suspended.delete(subjectId)
      blocked.add(subjectId)
    },

    async markDone(subjectId: string) {
      deferred.delete(subjectId)
      suspended.delete(subjectId)
      done.add(subjectId)
    },

    async markSuspended(subjectId: string) {
      suspended.add(subjectId)
    },

    async next() {
      if (input.untilTaskHandle && done.has(input.untilTaskHandle)) {
        return null
      }

      for (const subjectId of input.taskHandles) {
        if (done.has(subjectId)) {
          continue
        }
        if (blocked.has(subjectId)) {
          continue
        }
        if (suspended.has(subjectId)) {
          continue
        }
        if (deferred.has(subjectId)) {
          continue
        }
        return { subjectId }
      }

      const deferredSubject = deferred.values().next()
      if (!deferredSubject.done) {
        deferred.delete(deferredSubject.value)
        return {
          resumeFromSuspended: true,
          subjectId: deferredSubject.value,
        }
      }

      return null
    },

    async rebuild() {
      done.clear()
      blocked.clear()
      suspended.clear()
      deferred.clear()
      replan.clear()

      for (const subjectId of input.taskHandles) {
        const state = await input.store.loadState(input.protocol, subjectId)
        if (!state) {
          continue
        }
        if (state.status === TaskStatus.Done) {
          done.add(subjectId)
        } else if (state.status === TaskStatus.Blocked) {
          blocked.add(subjectId)
        } else if (state.status === TaskStatus.Replan) {
          replan.add(subjectId)
        } else if (state.status === TaskStatus.Suspended) {
          suspended.add(subjectId)
          deferred.add(subjectId)
        }
      }

      return {
        blocked: new Set(blocked),
        done: new Set(done),
        replan: new Set(replan),
        suspended: new Set(suspended),
      }
    },
  }
}

export function createBatchRetryScheduler(input: {
  files: string[]
  protocol: string
  results: Record<string, unknown>
  store: HarnessStore
}): Scheduler {
  const queue: { resumeFromSuspended: boolean; subjectId: string }[] = []
  const done = new Set<string>()
  const blocked = new Set<string>()
  const replan = new Set<string>()
  const suspended = new Set<string>()

  return {
    async markBlocked(subjectId: string) {
      const idx = queue.findIndex((item) => item.subjectId === subjectId)
      if (idx !== -1) {
        queue.splice(idx, 1)
      }
      blocked.add(subjectId)
    },

    async markDone(subjectId: string) {
      const idx = queue.findIndex((item) => item.subjectId === subjectId)
      if (idx !== -1) {
        queue.splice(idx, 1)
      }
      done.add(subjectId)
    },

    async markSuspended(subjectId: string) {
      const idx = queue.findIndex((item) => item.subjectId === subjectId)
      if (idx !== -1) {
        queue.splice(idx, 1)
      }
      suspended.add(subjectId)
      queue.push({ resumeFromSuspended: true, subjectId })
    },

    async next() {
      if (queue.length === 0) {
        return null
      }
      return queue[0]!
    },

    async rebuild() {
      queue.length = 0
      done.clear()
      blocked.clear()
      replan.clear()
      suspended.clear()

      for (const file of input.files) {
        if (file in input.results) {
          done.add(file)
          continue
        }

        const state = await input.store.loadState(input.protocol, file)
        if (!state) {
          queue.push({ resumeFromSuspended: false, subjectId: file })
          continue
        }

        if (state.status === TaskStatus.Done) {
          done.add(file)
        } else if (state.status === TaskStatus.Blocked) {
          blocked.add(file)
        } else if (state.status === TaskStatus.Replan) {
          replan.add(file)
        } else if (state.status === TaskStatus.Suspended) {
          suspended.add(file)
          queue.push({ resumeFromSuspended: true, subjectId: file })
        } else {
          queue.push({ resumeFromSuspended: false, subjectId: file })
        }
      }

      return {
        blocked: new Set(blocked),
        done: new Set(done),
        replan: new Set(replan),
        suspended: new Set(suspended),
      }
    },
  }
}
