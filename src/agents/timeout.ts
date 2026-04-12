export class AgentTimeoutError extends Error {
  public constructor(
    public readonly provider: string,
    public readonly timeout: number,
    options?: ErrorOptions,
  ) {
    super(`${provider} agent timed out after ${timeout}ms`, options)
  }
}

export async function withAbortTimeout<T>(
  provider: string,
  timeout: number | undefined,
  run: (controller: AbortController | undefined) => Promise<T>,
): Promise<T> {
  if (!timeout) {
    return run(undefined)
  }

  const controller = new AbortController()
  const state = { timedOut: false }
  const timer = setTimeout(() => {
    state.timedOut = true
    controller.abort()
  }, timeout)

  try {
    const result = await run(controller)
    if (state.timedOut) {
      throw new AgentTimeoutError(provider, timeout)
    }
    return result
  } catch (error) {
    if (state.timedOut) {
      throw new AgentTimeoutError(provider, timeout, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
