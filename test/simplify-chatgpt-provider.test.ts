import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { execa } from 'execa'
import { afterEach, expect, test } from 'vitest'

import {
  createProjectZip,
  runChatGptPage,
  type PageLike,
} from '../src/simplify/chatgpt-provider'

const workspaces: string[] = []

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-simplify-provider-'))
  workspaces.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((w) => rm(w, { force: true, recursive: true })),
  )
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

type WaitState = 'attached' | 'detached' | 'hidden' | 'visible'

interface FakeLocatorConfig {
  ariaChecked?: string
  count?: (() => number) | number
  filterResult?: FakeLocator
  nth?: FakeLocator[]
  textContent?: string
}

class FakeLocator {
  public constructor(
    private readonly log: string[],
    public readonly key: string,
    private readonly config: FakeLocatorConfig = {},
  ) {}

  public async click() {
    this.log.push(`click:${this.key}`)
  }

  public async count() {
    this.log.push(`count:${this.key}`)
    const c = this.config.count
    return typeof c === 'function' ? c() : (c ?? 1)
  }

  public async dispatchEvent(type: string) {
    this.log.push(`dispatch:${this.key}:${type}`)
  }

  public async fill(value: string) {
    this.log.push(`fill:${this.key}:${value}`)
  }

  public filter(options: { hasText: RegExp | string }) {
    this.log.push(`filter:${this.key}:${String(options.hasText)}`)
    return this.config.filterResult ?? this
  }

  public first() {
    return this
  }

  public async getAttribute(name: string) {
    this.log.push(`attr:${this.key}:${name}`)
    return name === 'aria-checked' ? (this.config.ariaChecked ?? null) : null
  }

  public nth(index: number) {
    this.log.push(`nth:${this.key}:${index}`)
    return (
      this.config.nth?.[index] ??
      new FakeLocator(this.log, `${this.key}[${index}]`)
    )
  }

  public async textContent() {
    return this.config.textContent ?? null
  }

  public async waitFor(options?: { state?: WaitState }) {
    this.log.push(`wait:${this.key}:${options?.state ?? 'visible'}`)
  }
}

class FakePage {
  private readonly locators = new Map<string, FakeLocator>()
  public readonly log: string[] = []

  public defineSelector(selector: string, locator: FakeLocator) {
    this.locators.set(`sel:${selector}`, locator)
  }

  public defineTestId(testId: string, locator: FakeLocator) {
    this.locators.set(`tid:${testId}`, locator)
  }

  public async evaluateHandle<Arg>(_fn: (arg: Arg) => unknown, arg: Arg) {
    const payload = arg as { name?: string }
    this.log.push(`handle:${payload.name ?? 'unknown'}`)
    return {
      async dispose() {},
    }
  }

  public getByTestId(testId: string) {
    const loc = this.locators.get(`tid:${testId}`)
    if (!loc) {
      throw new Error(`Missing test id: ${testId}`)
    }
    return loc
  }

  public async goto(url: string) {
    this.log.push(`goto:${url}`)
  }

  public locator(selector: string) {
    const loc = this.locators.get(`sel:${selector}`)
    if (!loc) {
      throw new Error(`Missing selector: ${selector}`)
    }
    return loc
  }
}

function createSimplifyPage(options?: {
  diffAppearsAfterPolls?: number
  diffFilename?: string
}) {
  const page = new FakePage()

  page.defineTestId(
    'model-switcher-dropdown-button',
    new FakeLocator(page.log, 'model-switcher'),
  )
  page.defineTestId(
    'model-switcher-gpt-5-4-pro',
    new FakeLocator(page.log, 'model-pro', { ariaChecked: 'false' }),
  )
  page.defineTestId('send-button', new FakeLocator(page.log, 'send-button'))

  const reasoningOptions = [
    new FakeLocator(page.log, 'reasoning-0', { ariaChecked: 'false' }),
    new FakeLocator(page.log, 'reasoning-1', { ariaChecked: 'false' }),
  ]
  page.defineSelector(
    'main button[aria-haspopup="menu"]:not(#composer-plus-btn)',
    new FakeLocator(page.log, 'reasoning-btn'),
  )
  page.defineSelector(
    '[role="menu"] [role="menuitemradio"]',
    new FakeLocator(page.log, 'reasoning-menu', {
      count: 2,
      nth: reasoningOptions,
    }),
  )
  page.defineSelector(
    'main [contenteditable="true"][role="textbox"]',
    new FakeLocator(page.log, 'composer'),
  )

  let pollCount = 0
  const appearsAfter = options?.diffAppearsAfterPolls ?? 1
  const diffFilename = options?.diffFilename ?? 'changes.diff'

  const diffButton = new FakeLocator(page.log, 'diff-button', {
    textContent: diffFilename,
    count() {
      pollCount++
      return pollCount >= appearsAfter ? 1 : 0
    },
  })
  page.defineSelector(
    '#thread button',
    new FakeLocator(page.log, 'thread-buttons', { filterResult: diffButton }),
  )

  return { diffButton, page }
}

test('runChatGptPage navigates, sets up model, drops file, sends, and polls for diff', async () => {
  const root = await createWorkspace()
  const zipPath = path.join(root, 'test.zip')
  await writeFile(zipPath, 'fake-zip-content')
  const { page } = createSimplifyPage({ diffAppearsAfterPolls: 1 })

  const diffFilename = await runChatGptPage(page as PageLike, {
    prompt: 'simplify please',
    zipPath,
    async delay() {},
  })

  expect(diffFilename).toBe('changes.diff')
  expect(page.log).toContain('goto:https://chatgpt.com/')
  expect(page.log).toContain('click:model-pro')
  expect(page.log).toContain('fill:composer:simplify please')
  expect(page.log).toContain('click:send-button')
  expect(page.log).toContain(String.raw`filter:thread-buttons:/\.diff$/i`)
  expect(page.log).toContain('click:diff-button')
})

test('runChatGptPage polls multiple times until diff button appears', async () => {
  const root = await createWorkspace()
  const zipPath = path.join(root, 'test.zip')
  await writeFile(zipPath, 'fake-zip-content')
  const { page } = createSimplifyPage({ diffAppearsAfterPolls: 3 })

  const diffFilename = await runChatGptPage(page as PageLike, {
    prompt: 'simplify',
    zipPath,
    async delay() {},
  })

  expect(diffFilename).toBe('changes.diff')
  const countCalls = page.log.filter((entry) =>
    entry.startsWith('count:diff-button'),
  )
  expect(countCalls.length).toBe(3)
})
