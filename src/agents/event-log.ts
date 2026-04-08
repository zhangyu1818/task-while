import type { ClaudeAgentEvent, ClaudeAgentEventHandler } from './claude'
import type { CodexThreadEvent, CodexThreadEventHandler } from './codex'

function formatInline(value: string) {
  return value.trim().replaceAll('\n', String.raw`\n`)
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function writeCodexEvent(event: CodexThreadEvent) {
  if (
    event.type === 'item.completed' ||
    event.type === 'item.started' ||
    event.type === 'item.updated'
  ) {
    const item = event.item

    if (item.type === 'reasoning') {
      const text = formatInline(item.text)
      if (text) {
        process.stderr.write(`[codex] thinking ${text}\n`)
      }
      return
    }

    if (item.type === 'command_execution') {
      if (event.type === 'item.started') {
        process.stderr.write(`[codex] exec ${formatInline(item.command)}\n`)
        return
      }
      if (event.type === 'item.completed') {
        process.stderr.write(
          `[codex] exec ${item.status} exit=${item.exit_code ?? 'unknown'} ${formatInline(item.command)}\n`,
        )
        const output = formatInline(item.aggregated_output)
        if (output) {
          process.stderr.write(`[codex] output ${output}\n`)
        }
        return
      }
    }

    if (item.type === 'mcp_tool_call') {
      const target = `${item.server}.${item.tool}`
      if (event.type === 'item.started') {
        process.stderr.write(
          `[codex] tool ${target} ${formatJson(item.arguments)}\n`,
        )
        return
      }
      if (event.type === 'item.completed') {
        const detail =
          item.status === 'failed'
            ? ` error=${item.error?.message ?? 'unknown'}`
            : ''
        process.stderr.write(`[codex] tool ${item.status} ${target}${detail}\n`)
        return
      }
    }

    if (item.type === 'file_change' && event.type === 'item.completed') {
      const files = item.changes.map((change) => change.path).join(', ')
      process.stderr.write(`[codex] files ${item.status} ${files}\n`)
      return
    }

    if (item.type === 'web_search') {
      process.stderr.write(`[codex] search ${formatInline(item.query)}\n`)
      return
    }

    if (item.type === 'todo_list') {
      for (const todo of item.items) {
        process.stderr.write(
          `[codex] todo ${todo.completed ? '[x]' : '[ ]'} ${formatInline(todo.text)}\n`,
        )
      }
      return
    }

    if (item.type === 'error') {
      process.stderr.write(`[codex] error ${formatInline(item.message)}\n`)
      return
    }

    if (item.type === 'agent_message' && event.type === 'item.completed') {
      const text = formatInline(item.text)
      if (text) {
        process.stderr.write(`[codex] message ${text}\n`)
      }
      return
    }
  }

  if (event.type === 'turn.completed') {
    process.stderr.write(
      `[codex] result tokens in=${event.usage.input_tokens} out=${event.usage.output_tokens} cached=${event.usage.cached_input_tokens}\n`,
    )
    return
  }

  if (event.type === 'error') {
    process.stderr.write(`[codex] error ${formatInline(event.message)}\n`)
    return
  }

  if (event.type === 'turn.failed') {
    process.stderr.write(`[codex] error ${formatInline(event.error.message)}\n`)
  }
}

function writeClaudeEvent(event: ClaudeAgentEvent) {
  if (event.type === 'system.init') {
    const tools = event.tools.length !== 0 ? event.tools.join(',') : '-'
    const skills = event.skills.length !== 0 ? event.skills.join(',') : '-'
    const mcp =
      event.mcpServers.length !== 0
        ? event.mcpServers
            .map((server) => `${server.name}:${server.status}`)
            .join(',')
        : '-'
    process.stderr.write(
      `[claude] init model=${event.model} permission=${event.permissionMode} tools=${tools} skills=${skills} mcp=${mcp}\n`,
    )
    return
  }

  if (event.type === 'task.started') {
    process.stderr.write(`[claude] task ${formatInline(event.description)}\n`)
    return
  }

  if (event.type === 'tool.progress') {
    process.stderr.write(
      `[claude] tool ${event.toolName} ${event.elapsedTimeSeconds}s\n`,
    )
    return
  }

  if (event.type === 'tool.summary') {
    process.stderr.write(
      `[claude] tool-summary ${formatInline(event.summary)}\n`,
    )
    return
  }

  if (event.type === 'task.progress') {
    const detail = event.summary ?? event.description
    process.stderr.write(
      `[claude] progress ${formatInline(event.lastToolName ?? '-')} ${formatInline(detail)}\n`,
    )
    return
  }

  if (event.type === 'text') {
    const text = formatInline(event.delta)
    if (text) {
      process.stderr.write(`[claude] text ${text}\n`)
    }
    return
  }

  if (event.type === 'result') {
    process.stderr.write(
      `[claude] result ${event.subtype} turns=${event.numTurns} duration=${event.durationMs}ms\n`,
    )
    return
  }

  process.stderr.write(`[claude] error ${formatInline(event.message)}\n`)
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
