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

test('createCodexEventHandler prints direct reasoning, command, tool and result lines', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const handler = createCodexEventHandler(true)

  expect(handler).toBeTypeOf('function')

  handler?.({
    type: 'item.completed',
    item: {
      id: 'reasoning-1',
      text: 'Inspecting verbose logger',
      type: 'reasoning',
    },
  })
  handler?.({
    type: 'item.started',
    item: {
      id: 'cmd-1',
      aggregated_output: '',
      command: 'rg verbose src',
      status: 'in_progress',
      type: 'command_execution',
    },
  })
  handler?.({
    type: 'item.completed',
    item: {
      id: 'cmd-1',
      aggregated_output: 'src/agents/event-log.ts:12:[codex] item.completed',
      command: 'rg verbose src',
      exit_code: 0,
      status: 'completed',
      type: 'command_execution',
    },
  })
  handler?.({
    type: 'item.started',
    item: {
      id: 'tool-1',
      arguments: { query: 'codex sdk verbose renderer' },
      server: 'brave_search',
      status: 'in_progress',
      tool: 'search',
      type: 'mcp_tool_call',
    },
  })
  handler?.({
    type: 'item.updated',
    item: {
      id: 'todo-1',
      items: [{ completed: true, text: 'Inspect renderer' }],
      type: 'todo_list',
    },
  })
  handler?.({
    type: 'item.completed',
    item: {
      id: 'message-1',
      text: 'done',
      type: 'agent_message',
    },
  })
  handler?.({
    type: 'turn.completed',
    usage: {
      cached_input_tokens: 2,
      input_tokens: 10,
      output_tokens: 5,
    },
  })

  expect(stderr.mock.calls.map((call) => call[0])).toEqual([
    '[codex] thinking Inspecting verbose logger\n',
    '[codex] exec rg verbose src\n',
    '[codex] exec completed exit=0 rg verbose src\n',
    '[codex] output src/agents/event-log.ts:12:[codex] item.completed\n',
    '[codex] tool brave_search.search {"query":"codex sdk verbose renderer"}\n',
    '[codex] todo [x] Inspect renderer\n',
    '[codex] message done\n',
    '[codex] result tokens in=10 out=5 cached=2\n',
  ])
})

test('createClaudeEventHandler prints Claude init, task, tool and result summaries', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  const handler = createClaudeEventHandler(true)

  expect(handler).toBeTypeOf('function')

  handler?.({
    mcpServers: [{ name: 'brave-search', status: 'connected' }],
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions',
    skills: ['deep-search'],
    tools: ['Read', 'Edit'],
    type: 'system.init',
  })
  handler?.({
    description: 'Inspect verbose logger',
    taskId: 'task-1',
    type: 'task.started',
  })
  handler?.({
    elapsedTimeSeconds: 1,
    toolName: 'Read',
    toolUseId: 'tool-1',
    type: 'tool.progress',
  })
  handler?.({
    summary: 'Read src/agents/event-log.ts',
    type: 'tool.summary',
  })
  handler?.({
    description: 'Inspect verbose logger',
    lastToolName: 'Read',
    summary: 'Inspected event-log.ts',
    taskId: 'task-1',
    type: 'task.progress',
  })
  handler?.({
    delta: 'hello',
    type: 'text',
  })
  handler?.({
    durationMs: 1200,
    numTurns: 1,
    subtype: 'success',
    type: 'result',
  })

  expect(stderr.mock.calls.map((call) => call[0])).toEqual([
    '[claude] init model=claude-sonnet-4-6 permission=bypassPermissions tools=Read,Edit skills=deep-search mcp=brave-search:connected\n',
    '[claude] task Inspect verbose logger\n',
    '[claude] tool Read 1s\n',
    '[claude] tool-summary Read src/agents/event-log.ts\n',
    '[claude] progress Read Inspected event-log.ts\n',
    '[claude] text hello\n',
    '[claude] result success turns=1 duration=1200ms\n',
  ])
})
