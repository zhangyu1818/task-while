import type { ClaudeAgentEvent, ClaudeAgentEventHandler } from './claude'
import type { CodexThreadEvent, CodexThreadEventHandler } from './codex'

function writeCodexEvent(event: CodexThreadEvent) {
  const itemType =
    event.type === 'item.completed' ||
    event.type === 'item.started' ||
    event.type === 'item.updated'
      ? event.item.type
      : null
  process.stderr.write(
    `[codex] ${event.type}${itemType ? ` ${itemType}` : ''}\n`,
  )
  if (
    event.type === 'item.completed' &&
    event.item.type === 'agent_message' &&
    event.item.text?.trim()
  ) {
    process.stderr.write(`[codex] message ${event.item.text.trim()}\n`)
  }
  if (event.type === 'error') {
    process.stderr.write(`[codex] error ${event.message}\n`)
  }
  if (event.type === 'turn.failed') {
    process.stderr.write(`[codex] error ${event.error.message}\n`)
  }
}

function writeClaudeEvent(event: ClaudeAgentEvent) {
  const detail = event.type === 'text' ? ` ${event.delta}` : ''
  process.stderr.write(`[claude] ${event.type}${detail}\n`)
}

export function createCodexEventHandler(
  verbose: boolean | undefined,
): CodexThreadEventHandler | undefined {
  if (!verbose) {
    return undefined
  }
  return writeCodexEvent
}

export function createClaudeEventHandler(
  verbose: boolean | undefined,
): ClaudeAgentEventHandler | undefined {
  if (!verbose) {
    return undefined
  }
  return writeClaudeEvent
}
