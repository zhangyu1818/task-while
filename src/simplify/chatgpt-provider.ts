import { createWriteStream } from 'node:fs'
import { access, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

import archiver from 'archiver'
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
const DIFF_BUTTON_PATTERN = /\.diff$/i
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
  textContent: () => Promise<null | string>
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

  const archive = archiver('zip', { zlib: { level: 9 } })
  const output = createWriteStream(options.outputPath)

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    for (const file of files) {
      archive.file(path.join(options.projectDir, file), { name: file })
    }

    archive.finalize()
  })
}

async function ensureProModel(page: PageLike) {
  const switcher = page.getByTestId(MODEL_SWITCHER_TEST_ID)
  await switcher.waitFor({ state: 'visible' })
  await switcher.click()

  const proOption = page.getByTestId(PRO_MODEL_TEST_ID)
  await proOption.waitFor({ state: 'visible' })
  if ((await proOption.getAttribute('aria-checked')) !== 'true') {
    await proOption.click()
    return
  }
  await switcher.click()
}

async function setHighestReasoning(page: PageLike) {
  const btn = page.locator(REASONING_BUTTON_SELECTOR)
  await btn.waitFor({ state: 'visible' })
  await btn.click()

  const options = page.locator(REASONING_OPTIONS_SELECTOR)
  const first = options.nth(0)
  await first.waitFor({ state: 'visible' })
  const count = await options.count()
  if (count < 1) {
    throw new Error('Unable to find reasoning options')
  }
  const highest = options.nth(count - 1)
  if ((await highest.getAttribute('aria-checked')) !== 'true') {
    await highest.click()
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

async function pollForDiffButton(
  page: PageLike,
  delay: (ms: number) => Promise<void>,
): Promise<string> {
  const threadButtons = page.locator(`${THREAD_SELECTOR} button`)

  for (;;) {
    const diffButtons = threadButtons.filter({ hasText: DIFF_BUTTON_PATTERN })
    if ((await diffButtons.count()) > 0) {
      const text = await diffButtons.first().textContent()
      await diffButtons.first().click()
      return text ?? 'unknown.diff'
    }
    await delay(POLL_INTERVAL_MS)
  }
}

export async function runChatGptPage(
  page: PageLike,
  options: {
    delay?: (ms: number) => Promise<void>
    prompt: string
    zipPath: string
  },
): Promise<string> {
  const delay = options.delay ?? ((ms: number) => setTimeout(ms))

  await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' })
  await ensureProModel(page)
  await setHighestReasoning(page)
  await dropFile(page, options.zipPath)
  await fillComposer(page, options.prompt)
  await delay(SEND_DELAY_MS)

  const sendButton = page.getByTestId(SEND_BUTTON_TEST_ID)
  await sendButton.click()

  return pollForDiffButton(page, delay)
}

async function waitForFile(filePath: string) {
  for (;;) {
    try {
      await access(filePath)
      return
    } catch {
      await setTimeout(1000)
    }
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
    const diffFilename = await runChatGptPage(page, {
      prompt: input.prompt,
      zipPath,
    })

    const diffPath = path.join(input.cwd, diffFilename)
    await waitForFile(diffPath)

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
