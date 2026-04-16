import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { execa } from 'execa'
import { glob } from 'glob'
import { chromium } from 'playwright'

const CHATGPT_URL = 'https://chatgpt.com/'
const MODEL_SWITCHER_TEST_ID = 'model-switcher-dropdown-button'
const PRO_MODEL_TEST_ID = 'model-switcher-gpt-5-4-pro'
const REASONING_BUTTON_SELECTOR =
  'main button[aria-haspopup="menu"]:not(#composer-plus-btn)'
const REASONING_OPTIONS_SELECTOR = '[role="menu"] [role="menuitemradio"]'
const COMPOSER_SELECTOR = 'main [contenteditable="true"][role="textbox"]'
const SEND_BUTTON_TEST_ID = 'send-button'
const THREAD_SELECTOR = '#thread'
const DIFF_BUTTON_PATTERN = /diff/i
const CLICK_DELAY_MIN_MS = 1_000
const CLICK_DELAY_MAX_MS = 3_000
const DOWNLOADED_DIFF_GLOB = '*.diff'
const DOWNLOAD_POLL_INTERVAL_MS = 1_000
const POLL_INTERVAL_MS = 60_000
const SEND_DELAY_MS = 60_000

type WaitState = 'attached' | 'detached' | 'hidden' | 'visible'

type EventInitLike = boolean | number | Record<string, unknown> | string

interface JsHandleLike {
  dispose: () => Promise<void>
}

interface LocatorLike {
  click: () => Promise<void>
  count: () => Promise<number>
  dispatchEvent: (
    type: string,
    eventInit?: EventInitLike,
    options?: { timeout?: number },
  ) => Promise<void>
  fill: (value: string) => Promise<void>
  filter: (options: { hasText: RegExp | string }) => LocatorLike
  first: () => LocatorLike
  getAttribute: (name: string) => Promise<null | string>
  nth: (index: number) => LocatorLike
  waitFor: (options?: { state?: WaitState }) => Promise<void>
}

export interface PageLike {
  evaluateHandle: <Arg>(
    pageFunction: (arg: Arg) => unknown,
    arg: Arg,
  ) => Promise<JsHandleLike>
  getByTestId: (testId: string) => LocatorLike
  goto: (
    url: string,
    options?: {
      waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle'
    },
  ) => Promise<unknown>
  locator: (selector: string) => LocatorLike
}

interface DropFilePayload {
  buffer: number[]
  name: string
  type: string
}

interface BrowserConstructors {
  DataTransfer: new () => { items: { add: (file: unknown) => void } }
  File: new (
    fileBits: ArrayBufferView[],
    fileName: string,
    options?: { type?: string },
  ) => unknown
}

function getRandomClickDelay(): number {
  const range = CLICK_DELAY_MAX_MS - CLICK_DELAY_MIN_MS
  const value = Math.max(0, Math.min(1, Math.random()))
  const offset = Math.min(range, Math.floor(value * (range + 1)))
  return CLICK_DELAY_MIN_MS + offset
}

async function clickWithRandomDelay(locator: LocatorLike) {
  await setTimeout(getRandomClickDelay())
  await locator.click()
}

export async function createProjectZip(options: {
  configPath: string
  exclude: string[]
  outputPath: string
  projectDir: string
}): Promise<void> {
  const configRelative = path.relative(options.projectDir, options.configPath)
  const files = await glob('**/*', {
    cwd: options.projectDir,
    dot: true,
    ignore: [...options.exclude, configRelative],
    nodir: true,
  })
  files.sort()
  await execa('zip', ['-q', options.outputPath, '-@'], {
    cwd: options.projectDir,
    input: files.join('\n'),
  })
}

async function ensureProModel(page: PageLike) {
  const switcher = page.getByTestId(MODEL_SWITCHER_TEST_ID)
  await switcher.waitFor({ state: 'visible' })
  await clickWithRandomDelay(switcher)

  const proOption = page.getByTestId(PRO_MODEL_TEST_ID)
  await proOption.waitFor({ state: 'visible' })
  if ((await proOption.getAttribute('aria-checked')) !== 'true') {
    await clickWithRandomDelay(proOption)
    return
  }
  await clickWithRandomDelay(switcher)
}

async function setHighestReasoning(page: PageLike) {
  const btn = page.locator(REASONING_BUTTON_SELECTOR)
  await btn.waitFor({ state: 'visible' })
  await clickWithRandomDelay(btn)

  const options = page.locator(REASONING_OPTIONS_SELECTOR)
  const first = options.nth(0)
  await first.waitFor({ state: 'visible' })
  const count = await options.count()
  if (count < 1) {
    throw new Error('Unable to find reasoning options')
  }
  const highest = options.nth(count - 1)
  if ((await highest.getAttribute('aria-checked')) !== 'true') {
    await clickWithRandomDelay(highest)
  }
}

async function dropFile(page: PageLike, filePath: string) {
  const composer = page.locator(COMPOSER_SELECTOR)
  await composer.waitFor({ state: 'visible' })

  const payload: DropFilePayload = {
    name: path.basename(filePath),
    buffer: Array.from(await readFile(filePath)),
    type: 'application/zip',
  }

  const dataTransfer = await page.evaluateHandle(
    ({ name, buffer, type }: DropFilePayload) => {
      const browser = globalThis as BrowserConstructors & typeof globalThis
      const file = new browser.File([Uint8Array.from(buffer)], name, { type })
      const transfer = new browser.DataTransfer()
      transfer.items.add(file)
      return transfer
    },
    payload,
  )

  try {
    await composer.dispatchEvent('dragenter', { dataTransfer })
    await composer.dispatchEvent('dragover', { dataTransfer })
    await composer.dispatchEvent('drop', { dataTransfer })
  } finally {
    await dataTransfer.dispose()
  }
}

async function fillComposer(page: PageLike, prompt: string) {
  const composer = page.locator(COMPOSER_SELECTOR)
  await composer.waitFor({ state: 'visible' })
  await composer.fill(prompt)
}

async function pollForDiffButton(page: PageLike): Promise<void> {
  const threadButtons = page.locator(`${THREAD_SELECTOR} button`)

  for (;;) {
    const diffButtons = threadButtons.filter({ hasText: DIFF_BUTTON_PATTERN })
    if ((await diffButtons.count()) > 0) {
      await clickWithRandomDelay(diffButtons.first())
      return
    }
    await setTimeout(POLL_INTERVAL_MS)
  }
}

export async function runChatGptPage(
  page: PageLike,
  options: {
    prompt: string
    zipPath: string
  },
): Promise<void> {
  await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' })
  await ensureProModel(page)
  await setHighestReasoning(page)
  await dropFile(page, options.zipPath)
  await fillComposer(page, options.prompt)
  await setTimeout(SEND_DELAY_MS)

  const sendButton = page.getByTestId(SEND_BUTTON_TEST_ID)
  await clickWithRandomDelay(sendButton)

  await pollForDiffButton(page)
}

async function listDownloadedDiffFiles(dirPath: string): Promise<string[]> {
  const files = await glob(DOWNLOADED_DIFF_GLOB, {
    cwd: dirPath,
    nodir: true,
  })
  files.sort()
  return files.map((file) => path.join(dirPath, file))
}

export async function waitForDownloadedDiffFile(dirPath: string): Promise<string> {
  const knownFiles = new Set(await listDownloadedDiffFiles(dirPath))

  for (;;) {
    const currentFiles = await listDownloadedDiffFiles(dirPath)
    const newFile = currentFiles.find((file) => !knownFiles.has(file))
    if (newFile) {
      return newFile
    }
    await setTimeout(DOWNLOAD_POLL_INTERVAL_MS)
  }
}

export interface SimplifyTurnInput {
  cdpUrl?: string
  configPath: string
  cwd: string
  exclude: string[]
  prompt: string
  turn: number
}

export async function runSimplifyTurn(input: SimplifyTurnInput): Promise<void> {
  const projectName = path.basename(input.cwd)
  const zipFilename = `${projectName}_simplify_${input.turn}.zip`
  const zipPath = path.join(input.cwd, zipFilename)

  await createProjectZip({
    configPath: input.configPath,
    exclude: input.exclude,
    outputPath: zipPath,
    projectDir: input.cwd,
  })

  const cdpUrl = input.cdpUrl ?? 'http://127.0.0.1:9222'
  const browser = await chromium.connectOverCDP(cdpUrl)
  const context = browser.contexts()[0]
  if (!context) {
    throw new Error(`No browser context available at ${cdpUrl}`)
  }

  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: input.cwd,
  })

  try {
    const diffPathPromise = waitForDownloadedDiffFile(input.cwd)

    await runChatGptPage(page, {
      prompt: input.prompt,
      zipPath,
    })

    const diffPath = await diffPathPromise

    await execa('git', ['apply', diffPath], { cwd: input.cwd })

    await Promise.all([unlink(diffPath), unlink(zipPath)])

    const configRelative = path.relative(input.cwd, input.configPath)
    await execa('git', ['add', '-A', '.'], { cwd: input.cwd })
    await execa('git', ['reset', '--', configRelative], { cwd: input.cwd })
    await execa('git', ['commit', '-m', `simplify turn ${input.turn}`], {
      cwd: input.cwd,
    })
  } finally {
    await page.close()
    await browser.close()
  }
}
