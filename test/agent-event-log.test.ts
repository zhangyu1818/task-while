import { beforeEach, expect, test, vi } from 'vitest'

import {
  createClaudeEventHandler,
  createCodexEventHandler,
} from '../src/agents/event-log'

beforeEach(() => {
  vi.restoreAllMocks()
})

test('createCodexEventHandler returns undefined when verbose is disabled', () => {
  expect(createCodexEventHandler(false)).toBeUndefined()
  expect(createCodexEventHandler(undefined)).toBeUndefined()
})

test('createClaudeEventHandler returns undefined when verbose is disabled', () => {
  expect(createClaudeEventHandler(false)).toBeUndefined()
  expect(createClaudeEventHandler(undefined)).toBeUndefined()
})

test('createCodexEventHandler prints codex event details to stderr', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const handler = createCodexEventHandler(true)

  expect(handler).toBeTypeOf('function')

  handler?.({
    type: 'item.completed',
    item: {
      text: 'done',
      type: 'agent_message',
    },
  })

  expect(stderr.mock.calls.map((call) => call[0])).toEqual([
    '[codex] item.completed agent_message\n',
    '[codex] message done\n',
  ])
})

test('createClaudeEventHandler prints claude text deltas to stderr', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const handler = createClaudeEventHandler(true)

  expect(handler).toBeTypeOf('function')

  handler?.({
    delta: 'partial output',
    type: 'text',
  })

  expect(stderr).toHaveBeenCalledWith('[claude] text partial output\n')
})
