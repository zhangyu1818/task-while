import { afterEach, expect, test, vi } from 'vitest'

import { AgentTimeoutError, withAbortTimeout } from '../src/agents/timeout'

afterEach(() => {
  vi.useRealTimers()
})

test('withAbortTimeout returns the underlying result when timeout is not configured', async () => {
  const result = await withAbortTimeout('codex', undefined, async () => 'ok')

  expect(result).toBe('ok')
})

test('withAbortTimeout aborts the running operation and throws a timeout error', async () => {
  await expect(
    withAbortTimeout('claude', 1, async (controller) => {
      await new Promise<void>((resolve) => {
        controller!.signal.addEventListener('abort', () => resolve(), {
          once: true,
        })
      })
      return 'late'
    }),
  ).rejects.toBeInstanceOf(AgentTimeoutError)

  await expect(
    withAbortTimeout('claude', 1, async (controller) => {
      await new Promise<void>((resolve) => {
        controller!.signal.addEventListener('abort', () => resolve(), {
          once: true,
        })
      })
      return 'late'
    }),
  ).rejects.toThrow(/claude agent timed out after 1ms/i)
})
