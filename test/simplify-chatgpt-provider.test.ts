import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createSimplifyPage } from './simplify-chatgpt-provider.page-test-helpers'

const execaState = vi.hoisted(() => ({
  impl: null as ((...args: unknown[]) => unknown) | null,
}))

const timeoutState = vi.hoisted(() => ({
  calls: [] as number[],
  onCall: null as ((ms: number) => Promise<void> | void) | null,
}))

vi.mock('execa', async (importOriginal) => {
  const original = await importOriginal<typeof import('execa')>()
  return {
    ...original,
    execa: vi.fn((...args: Parameters<typeof original.execa>) => {
      if (execaState.impl) {
        return execaState.impl(...args)
      }
      return original.execa(...args)
    }),
  }
})

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(async (ms: number) => {
    timeoutState.calls.push(ms)
    if (timeoutState.onCall) {
      await timeoutState.onCall(ms)
    }
  }),
}))

const { execa } = await import('execa')
const { createProjectZip, runChatGptPage, waitForDownloadedDiffFile } =
  await import('../src/simplify/chatgpt-provider')
type PageLike = import('../src/simplify/chatgpt-provider').PageLike

const workspaces: string[] = []

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-simplify-provider-'))
  workspaces.push(root)
  return root
}

beforeEach(() => {
  execaState.impl = null
  timeoutState.calls = []
  timeoutState.onCall = null
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    workspaces.splice(0).map((w) => rm(w, { force: true, recursive: true })),
  )
})

test('createProjectZip shells out to the system zip command', async () => {
  const root = await createWorkspace()
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, 'src', 'utils.ts'), 'export const b = 2\n')
  const zipPath = path.join(root, 'output.zip')

  const calls: unknown[][] = []
  execaState.impl = vi.fn(async (...args: unknown[]) => {
    calls.push(args)
    return { command: '', escapedCommand: '', exitCode: 0, stderr: '', stdout: '' }
  })

  await createProjectZip({
    configPath: path.join(root, 'simplify.yaml'),
    exclude: [],
    outputPath: zipPath,
    projectDir: root,
  })

  expect(calls).toHaveLength(1)
  const [file, args, options] = calls[0] as [
    string,
    string[],
    { cwd: string; input: string },
  ]
  expect(file).toBe('zip')
  expect(args).toEqual(['-q', zipPath, '-@'])
  expect(options).toMatchObject({
    cwd: root,
    input: 'src/index.ts\nsrc/utils.ts',
  })
})

test('createProjectZip creates a zip containing project files', async () => {
  const root = await createWorkspace()
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, 'src', 'utils.ts'), 'export const b = 2\n')
  const zipPath = path.join(root, 'output.zip')

  await createProjectZip({
    configPath: path.join(root, 'simplify.yaml'),
    exclude: [],
    outputPath: zipPath,
    projectDir: root,
  })

  const fileStat = await stat(zipPath)
  expect(fileStat.size).toBeGreaterThan(0)
  const { stdout } = await execa('unzip', ['-l', zipPath])
  expect(stdout).toContain('src/index.ts')
  expect(stdout).toContain('src/utils.ts')
})

test('createProjectZip excludes files matching exclude globs', async () => {
  const root = await createWorkspace()
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 1\n')
  await writeFile(path.join(root, 'dist', 'bundle.js'), 'compiled\n')
  const zipPath = path.join(root, 'output.zip')

  await createProjectZip({
    configPath: path.join(root, 'simplify.yaml'),
    exclude: ['dist/**'],
    outputPath: zipPath,
    projectDir: root,
  })

  const { stdout } = await execa('unzip', ['-l', zipPath])
  expect(stdout).toContain('src/index.ts')
  expect(stdout).not.toContain('bundle.js')
})

test('createProjectZip excludes the config file itself', async () => {
  const root = await createWorkspace()
  await writeFile(path.join(root, 'app.ts'), 'const x = 1\n')
  const configPath = path.join(root, 'simplify.yaml')
  await writeFile(configPath, 'provider: chatgpt\n')
  const zipPath = path.join(root, 'output.zip')

  await createProjectZip({
    configPath,
    exclude: [],
    outputPath: zipPath,
    projectDir: root,
  })

  const { stdout } = await execa('unzip', ['-l', zipPath])
  expect(stdout).toContain('app.ts')
  expect(stdout).not.toContain('simplify.yaml')
})

test('runChatGptPage navigates, sets up model, drops file, sends, and clicks a button whose text contains diff', async () => {
  const root = await createWorkspace()
  const zipPath = path.join(root, 'test.zip')
  await writeFile(zipPath, 'fake-zip-content')
  const { page } = createSimplifyPage({ diffAppearsAfterPolls: 1 })

  await runChatGptPage(page as PageLike, {
    prompt: 'simplify please',
    zipPath,
  })

  expect(page.log).toContain('goto:https://chatgpt.com/')
  expect(page.log).toContain('click:model-pro')
  expect(page.log).toContain('fill:composer:simplify please')
  expect(page.log).toContain('click:send-button')
  expect(page.log).toContain(String.raw`filter:thread-buttons:/diff/i`)
  expect(page.log).toContain('click:diff-button')
})

test('runChatGptPage waits 1-3 seconds before each click', async () => {
  const root = await createWorkspace()
  const zipPath = path.join(root, 'test.zip')
  await writeFile(zipPath, 'fake-zip-content')
  const { page } = createSimplifyPage({ diffAppearsAfterPolls: 1 })

  vi.spyOn(Math, 'random')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0.25)
    .mockReturnValueOnce(0.5)
    .mockReturnValueOnce(0.75)
    .mockReturnValueOnce(0.9)
    .mockReturnValueOnce(0.1)

  await runChatGptPage(page as PageLike, {
    prompt: 'simplify please',
    zipPath,
  })

  expect(timeoutState.calls).toEqual([1000, 1500, 2000, 2500, 60_000, 2800, 1200])
})

test('runChatGptPage polls multiple times until diff button appears', async () => {
  const root = await createWorkspace()
  const zipPath = path.join(root, 'test.zip')
  await writeFile(zipPath, 'fake-zip-content')
  const { page } = createSimplifyPage({ diffAppearsAfterPolls: 3 })

  await runChatGptPage(page as PageLike, {
    prompt: 'simplify',
    zipPath,
  })

  const countCalls = page.log.filter((entry) =>
    entry.startsWith('count:diff-button'),
  )
  expect(countCalls.length).toBe(3)
})

test('waitForDownloadedDiffFile returns a newly downloaded diff file', async () => {
  const root = await createWorkspace()
  const downloadedDiffPath = path.join(root, 'downloaded.diff')
  await writeFile(path.join(root, 'existing.diff'), 'old diff')

  let created = false
  timeoutState.onCall = async (ms) => {
    if (ms === 1_000 && !created) {
      created = true
      await writeFile(downloadedDiffPath, 'new diff')
    }
  }

  const result = await waitForDownloadedDiffFile(root)

  expect(result).toBe(downloadedDiffPath)
})
