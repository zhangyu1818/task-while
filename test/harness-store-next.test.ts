import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createFsHarnessStore } from '../src/adapters/fs/harness-store'
import { createInMemoryHarnessStore } from '../src/harness/in-memory-store'
import { createInitialState, TaskStatus } from '../src/harness/state'

import type { HarnessStore } from '../src/harness/store'

function runStoreTests(
  name: string,
  factory: () => Promise<{
    cleanup?: () => Promise<void>
    store: HarnessStore
  }>,
) {
  describe(`${name} harness store`, () => {
    let store: HarnessStore
    let cleanup: (() => Promise<void>) | undefined

    afterEach(async () => {
      await cleanup?.()
    })

    test('saves and loads state', async () => {
      const ctx = await factory()
      store = ctx.store
      cleanup = ctx.cleanup

      const state = createInitialState()
      await store.saveState('run-direct', 'T001', state)

      const loaded = await store.loadState('run-direct', 'T001')
      expect(loaded).toStrictEqual(state)
    })

    test('returns null for missing state', async () => {
      const ctx = await factory()
      store = ctx.store
      cleanup = ctx.cleanup

      const loaded = await store.loadState('run-direct', 'missing')
      expect(loaded).toBeNull()
    })

    test('saves and loads artifacts', async () => {
      const ctx = await factory()
      store = ctx.store
      cleanup = ctx.cleanup

      const artifact = {
        id: 'contract-T001-1',
        kind: 'contract',
        subjectId: 'T001',
        timestamp: '2026-04-10T00:00:00.000Z',
        payload: {
          completionCriteria: ['works'],
          prompt: { instructions: ['do it'], sections: [] },
        },
      }

      await store.saveArtifact('run-direct', 'T001', artifact)
      const loaded = await store.loadArtifact(
        'run-direct',
        'T001',
        'contract-T001-1',
      )
      expect(loaded).toStrictEqual(artifact)
    })

    test('lists artifacts for a subject', async () => {
      const ctx = await factory()
      store = ctx.store
      cleanup = ctx.cleanup

      await store.saveArtifact('run-direct', 'T001', {
        id: 'a1',
        kind: 'contract',
        payload: {},
        subjectId: 'T001',
        timestamp: '2026-04-10T00:00:00.000Z',
      })
      await store.saveArtifact('run-direct', 'T001', {
        id: 'a2',
        kind: 'implementation',
        payload: {},
        subjectId: 'T001',
        timestamp: '2026-04-10T00:00:01.000Z',
      })

      const list = await store.listArtifacts('run-direct', 'T001')
      expect(list).toHaveLength(2)
    })

    test('appends transition records without throwing', async () => {
      const ctx = await factory()
      store = ctx.store
      cleanup = ctx.cleanup

      await store.appendTransition('run-direct', 'T001', {
        nextPhase: 'implement',
        phase: 'contract',
        resultKind: 'contract.generated',
        status: TaskStatus.Running,
        timestamp: '2026-04-10T00:00:00.000Z',
      })
    })
  })
}

runStoreTests('in-memory', async () => ({
  store: createInMemoryHarnessStore(),
}))

runStoreTests('filesystem', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-store-'))
  return {
    store: createFsHarnessStore(root),
    cleanup: () => rm(root, { force: true, recursive: true }),
  }
})

describe('filesystem harness store path safety', () => {
  test('encodes artifact filenames when id contains colon', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'while-store-'))
    const store = createFsHarnessStore(root)
    const artifact = {
      id: 'prepare:input%2Fa.txt',
      kind: 'prepare',
      payload: { filePath: 'input/a.txt' },
      subjectId: 'input/a.txt',
      timestamp: '2026-04-10T00:00:00.000Z',
    }

    try {
      await store.saveArtifact('batch', 'input/a.txt', artifact)

      const dir = path.join(
        root,
        'artifacts',
        'batch',
        encodeURIComponent('input/a.txt'),
      )
      const entries = await readdir(dir)

      expect(entries).toHaveLength(1)
      expect(entries[0]).not.toContain(':')

      const loaded = await store.loadArtifact(
        'batch',
        'input/a.txt',
        'prepare:input%2Fa.txt',
      )
      expect(loaded).toStrictEqual(artifact)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
