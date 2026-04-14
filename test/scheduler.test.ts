import { describe, expect, test } from 'vitest'

import { createInMemoryHarnessStore } from '../src/harness/in-memory-store'
import { createInitialState, TaskStatus } from '../src/harness/state'
import {
  createBatchRetryScheduler,
  createTaskQueueScheduler,
} from '../src/schedulers/scheduler'

describe('createTaskQueueScheduler', () => {
  const protocol = 'test-protocol'

  test('yields tasks in source order', async () => {
    const store = createInMemoryHarnessStore()
    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a', 'b', 'c'],
    })

    await scheduler.rebuild()

    const first = await scheduler.next()
    expect(first).toEqual({ subjectId: 'a' })

    await scheduler.markDone('a')
    const second = await scheduler.next()
    expect(second).toEqual({ subjectId: 'b' })

    await scheduler.markDone('b')
    const third = await scheduler.next()
    expect(third).toEqual({ subjectId: 'c' })
  })

  test('skips already-done tasks from store on rebuild', async () => {
    const store = createInMemoryHarnessStore()

    const doneState = createInitialState()
    doneState.status = TaskStatus.Done
    doneState.completedAt = new Date().toISOString()
    await store.saveState(protocol, 'a', doneState)

    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a', 'b'],
    })

    await scheduler.rebuild()

    const next = await scheduler.next()
    expect(next).toEqual({ subjectId: 'b' })
  })

  test('returns null when no more tasks', async () => {
    const store = createInMemoryHarnessStore()
    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a'],
    })

    await scheduler.rebuild()
    await scheduler.markDone('a')

    const next = await scheduler.next()
    expect(next).toBeNull()
  })

  test('suspended subject is not rescheduled within same session', async () => {
    const store = createInMemoryHarnessStore()
    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a'],
    })

    await scheduler.rebuild()

    const first = await scheduler.next()
    expect(first).toEqual({ subjectId: 'a' })

    await scheduler.markSuspended('a')
    const second = await scheduler.next()
    expect(second).toBeNull()
  })

  test('suspended subjects resume after rebuild', async () => {
    const store = createInMemoryHarnessStore()

    const state = createInitialState()
    state.status = TaskStatus.Suspended
    state.currentPhase = 'review'
    await store.saveState(protocol, 'a', state)

    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a'],
    })

    const sets = await scheduler.rebuild()
    expect(sets.suspended.has('a')).toBe(true)

    const next = await scheduler.next()
    expect(next).toEqual({ resumeFromSuspended: true, subjectId: 'a' })
  })

  test('rebuild returns replan set separate from blocked', async () => {
    const store = createInMemoryHarnessStore()

    const blockedState = createInitialState()
    blockedState.status = TaskStatus.Blocked
    await store.saveState(protocol, 'a', blockedState)

    const replanState = createInitialState()
    replanState.status = TaskStatus.Replan
    await store.saveState(protocol, 'b', replanState)

    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a', 'b'],
    })

    const sets = await scheduler.rebuild()
    expect(sets.blocked.has('a')).toBe(true)
    expect(sets.blocked.has('b')).toBe(false)
    expect(sets.replan.has('b')).toBe(true)
    expect(sets.replan.has('a')).toBe(false)
  })

  test('untilTaskHandle stops after target done', async () => {
    const store = createInMemoryHarnessStore()
    const scheduler = createTaskQueueScheduler({
      protocol,
      store,
      taskHandles: ['a', 'b', 'c'],
      untilTaskHandle: 'b',
    })

    await scheduler.rebuild()

    await scheduler.markDone('a')
    const second = await scheduler.next()
    expect(second).toEqual({ subjectId: 'b' })

    await scheduler.markDone('b')
    const afterTarget = await scheduler.next()
    expect(afterTarget).toBeNull()
  })
})

describe('createBatchRetryScheduler', () => {
  const protocol = 'test-protocol'

  test('yields files in order, skipping done', async () => {
    const store = createInMemoryHarnessStore()

    const doneState = createInitialState()
    doneState.status = TaskStatus.Done
    doneState.completedAt = new Date().toISOString()
    await store.saveState(protocol, 'file-b.json', doneState)

    const scheduler = createBatchRetryScheduler({
      files: ['file-a.json', 'file-b.json', 'file-c.json'],
      protocol,
      results: {},
      store,
    })

    await scheduler.rebuild()

    const first = await scheduler.next()
    expect(first!.subjectId).toBe('file-a.json')
    expect(first!.resumeFromSuspended).toBe(false)

    await scheduler.markDone('file-a.json')
    const second = await scheduler.next()
    expect(second!.subjectId).toBe('file-c.json')
  })

  test('suspended items go to end of queue', async () => {
    const store = createInMemoryHarnessStore()
    const scheduler = createBatchRetryScheduler({
      files: ['a.json', 'b.json', 'c.json'],
      protocol,
      results: {},
      store,
    })

    await scheduler.rebuild()

    const first = await scheduler.next()
    expect(first!.subjectId).toBe('a.json')

    await scheduler.markSuspended('a.json')
    const second = await scheduler.next()
    expect(second!.subjectId).toBe('b.json')

    await scheduler.markDone('b.json')
    const third = await scheduler.next()
    expect(third!.subjectId).toBe('c.json')

    await scheduler.markDone('c.json')
    const recycled = await scheduler.next()
    expect(recycled!.subjectId).toBe('a.json')
    expect(recycled!.resumeFromSuspended).toBe(true)
  })
})
