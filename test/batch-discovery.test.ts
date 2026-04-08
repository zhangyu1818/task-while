import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { discoverBatchFiles } from '../src/batch/discovery'

const workspaces: string[] = []

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-discovery-'))
  workspaces.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

test('discoverBatchFiles matches root files and nested files in stable order', async () => {
  const root = await createWorkspace()
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
  await writeFile(path.join(root, 'a.txt'), 'alpha\n')
  await writeFile(path.join(root, 'src', 'nested', 'z.txt'), 'zeta\n')

  const files = await discoverBatchFiles({
    baseDir: root,
    excludedFiles: new Set(),
    patterns: ['**/*.txt'],
  })

  expect(files).toEqual(['a.txt', 'src/nested/z.txt'])
})

test('discoverBatchFiles ORs multiple glob patterns and drops duplicates', async () => {
  const root = await createWorkspace()
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(
    path.join(root, 'src', 'b.tsx'),
    'export const B = () => null\n',
  )

  const files = await discoverBatchFiles({
    baseDir: root,
    excludedFiles: new Set(),
    patterns: ['src/**/*.ts', 'src/**/*.{ts,tsx}', 'src/**/*.tsx'],
  })

  expect(files).toEqual(['src/a.ts', 'src/b.tsx'])
})

test('discoverBatchFiles excludes runtime files even when glob matches them', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'batch.yaml')
  const statePath = path.join(root, 'state.json')
  const resultsPath = path.join(root, 'results.json')
  await writeFile(configPath, 'provider: codex\n')
  await writeFile(statePath, '{}\n')
  await writeFile(resultsPath, '{}\n')
  await writeFile(path.join(root, 'keep.txt'), 'keep\n')

  const files = await discoverBatchFiles({
    baseDir: root,
    excludedFiles: new Set([configPath, statePath, resultsPath]),
    patterns: ['**/*'],
  })

  expect(files).toEqual(['keep.txt'])
})
