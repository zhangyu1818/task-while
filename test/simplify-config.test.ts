import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { loadSimplifyConfig } from '../src/simplify/config'

const workspaces: string[] = []

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-simplify-config-'))
  workspaces.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((w) => rm(w, { force: true, recursive: true })),
  )
})

test('loadSimplifyConfig parses a valid config with all fields', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    [
      'provider: chatgpt',
      'turns: 3',
      'exclude:',
      '  - "node_modules/**"',
      '  - "dist/**"',
      'prompt: |',
      '  Simplify iteration {{turn}}',
      '',
    ].join('\n'),
  )

  const config = await loadSimplifyConfig({ configPath, cwd: root })

  expect(config).toMatchObject({
    configDir: root,
    configPath,
    exclude: ['node_modules/**', 'dist/**'],
    prompt: 'Simplify iteration {{turn}}',
    provider: 'chatgpt',
    turns: 3,
  })
})

test('loadSimplifyConfig defaults exclude to empty array', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    ['provider: chatgpt', 'turns: 1', 'prompt: simplify', ''].join('\n'),
  )

  const config = await loadSimplifyConfig({ configPath, cwd: root })

  expect(config.exclude).toEqual([])
})

test('loadSimplifyConfig accepts a single string exclude value', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    [
      'provider: chatgpt',
      'turns: 1',
      'exclude: "dist/**"',
      'prompt: simplify',
      '',
    ].join('\n'),
  )

  const config = await loadSimplifyConfig({ configPath, cwd: root })

  expect(config.exclude).toEqual(['dist/**'])
})

test('loadSimplifyConfig rejects unknown fields', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    [
      'provider: chatgpt',
      'turns: 1',
      'prompt: simplify',
      'extra: value',
      '',
    ].join('\n'),
  )

  await expect(loadSimplifyConfig({ configPath, cwd: root })).rejects.toThrow()
})

test('loadSimplifyConfig rejects missing prompt', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(configPath, ['provider: chatgpt', 'turns: 1', ''].join('\n'))

  await expect(loadSimplifyConfig({ configPath, cwd: root })).rejects.toThrow()
})

test('loadSimplifyConfig rejects non-positive turns', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    ['provider: chatgpt', 'turns: 0', 'prompt: simplify', ''].join('\n'),
  )

  await expect(loadSimplifyConfig({ configPath, cwd: root })).rejects.toThrow()
})

test('loadSimplifyConfig rejects unknown provider', async () => {
  const root = await createWorkspace()
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(
    configPath,
    ['provider: unknown', 'turns: 1', 'prompt: simplify', ''].join('\n'),
  )

  await expect(loadSimplifyConfig({ configPath, cwd: root })).rejects.toThrow()
})
