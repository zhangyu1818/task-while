type WaitState = 'attached' | 'detached' | 'hidden' | 'visible'

interface FakeLocatorConfig {
  ariaChecked?: string
  count?: (() => number) | number
  filterResult?: FakeLocator
  nth?: FakeLocator[]
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

export function createSimplifyPage(options?: { diffAppearsAfterPolls?: number }) {
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

  const diffButton = new FakeLocator(page.log, 'diff-button', {
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
