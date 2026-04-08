import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema/index'

import type { Options as ClaudeQueryOptions } from '@anthropic-ai/claude-agent-sdk'

import type { ClaudeProviderOptions } from './provider-options'
import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from './types'

export interface ClaudeTextEvent {
  delta: string
  type: 'text'
}

export interface ClaudeInitEvent {
  mcpServers: { name: string; status: string }[]
  model: string
  permissionMode: string
  skills: string[]
  tools: string[]
  type: 'system.init'
}

export interface ClaudeTaskStartedEvent {
  description: string
  taskId: string
  type: 'task.started'
}

export interface ClaudeTaskProgressEvent {
  description: string
  lastToolName?: string
  summary?: string
  taskId: string
  type: 'task.progress'
}

export interface ClaudeToolProgressEvent {
  elapsedTimeSeconds: number
  toolName: string
  toolUseId: string
  type: 'tool.progress'
}

export interface ClaudeToolSummaryEvent {
  summary: string
  type: 'tool.summary'
}

export interface ClaudeResultEvent {
  durationMs: number
  numTurns: number
  subtype: 'success'
  type: 'result'
}

export interface ClaudeErrorEvent {
  message: string
  type: 'error'
}

export type ClaudeAgentEvent =
  | ClaudeErrorEvent
  | ClaudeInitEvent
  | ClaudeResultEvent
  | ClaudeTaskProgressEvent
  | ClaudeTaskStartedEvent
  | ClaudeTextEvent
  | ClaudeToolProgressEvent
  | ClaudeToolSummaryEvent

export type ClaudeAgentEventHandler = (event: ClaudeAgentEvent) => void

interface QueryResultMessage {
  duration_ms?: number
  errors?: string[]
  num_turns?: number
  structured_output?: unknown
  subtype: string
  type: 'result'
}

interface QueryStreamEventMessage {
  event: {
    delta?: { text?: string; type?: string }
    type: string
  }
  type: 'stream_event'
}

interface QueryAssistantMessage {
  type: 'assistant'
}

interface QuerySystemInitMessage {
  mcp_servers: { name: string; status: string }[]
  model: string
  permissionMode: string
  skills: string[]
  subtype: 'init'
  tools: string[]
  type: 'system'
}

interface QueryTaskStartedMessage {
  description: string
  subtype: 'task_started'
  task_id: string
  type: 'system'
}

interface QueryTaskProgressMessage {
  description: string
  last_tool_name?: string
  subtype: 'task_progress'
  summary?: string
  task_id: string
  type: 'system'
}

interface QueryToolProgressMessage {
  elapsed_time_seconds: number
  tool_name: string
  tool_use_id: string
  type: 'tool_progress'
}

interface QueryToolUseSummaryMessage {
  summary: string
  type: 'tool_use_summary'
}

type QueryMessage =
  | QueryAssistantMessage
  | QueryResultMessage
  | QueryStreamEventMessage
  | QuerySystemInitMessage
  | QueryTaskProgressMessage
  | QueryTaskStartedMessage
  | QueryToolProgressMessage
  | QueryToolUseSummaryMessage

export interface ClaudeAgentClientOptions extends ClaudeProviderOptions {
  onEvent?: ClaudeAgentEventHandler
  workspaceRoot: string
}

export interface ClaudeStructuredInput {
  outputSchema: Record<string, unknown>
  prompt: string
}

export class ClaudeAgentClient
  implements ImplementerProvider, ReviewerProvider
{
  public readonly name = 'claude'

  public constructor(private readonly options: ClaudeAgentClientOptions) {}

  private async collectStructuredOutput(
    messages: AsyncIterable<QueryMessage>,
  ): Promise<unknown> {
    let structuredOutput: unknown = null

    for await (const message of messages) {
      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        this.options.onEvent
      ) {
        this.options.onEvent({
          mcpServers: message.mcp_servers,
          model: message.model,
          permissionMode: message.permissionMode,
          skills: message.skills,
          tools: message.tools,
          type: 'system.init',
        })
      }

      if (
        message.type === 'system' &&
        message.subtype === 'task_started' &&
        this.options.onEvent
      ) {
        this.options.onEvent({
          description: message.description,
          taskId: message.task_id,
          type: 'task.started',
        })
      }

      if (
        message.type === 'system' &&
        message.subtype === 'task_progress' &&
        this.options.onEvent
      ) {
        this.options.onEvent({
          description: message.description,
          taskId: message.task_id,
          type: 'task.progress',
          ...(message.last_tool_name
            ? { lastToolName: message.last_tool_name }
            : {}),
          ...(message.summary ? { summary: message.summary } : {}),
        })
      }

      if (message.type === 'tool_progress' && this.options.onEvent) {
        this.options.onEvent({
          elapsedTimeSeconds: message.elapsed_time_seconds,
          toolName: message.tool_name,
          toolUseId: message.tool_use_id,
          type: 'tool.progress',
        })
      }

      if (message.type === 'tool_use_summary' && this.options.onEvent) {
        this.options.onEvent({
          summary: message.summary,
          type: 'tool.summary',
        })
      }

      if (message.type === 'stream_event' && this.options.onEvent) {
        const event = message.event
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          this.options.onEvent({ delta: event.delta.text, type: 'text' })
        }
      }

      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          const detail = message.errors?.join('; ') ?? message.subtype
          throw new Error(`Claude agent query failed: ${detail}`)
        }
        structuredOutput = message.structured_output ?? null
        if (this.options.onEvent) {
          this.options.onEvent({
            durationMs: message.duration_ms ?? 0,
            numTurns: message.num_turns ?? 0,
            subtype: 'success',
            type: 'result',
          })
        }
      }
    }

    if (structuredOutput === null || structuredOutput === undefined) {
      throw new Error('Claude agent returned no structured output')
    }

    return structuredOutput
  }

  public async implement(input: ImplementAgentInput) {
    const prompt = await buildImplementerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: implementOutputSchema,
      prompt,
    })
    return validateImplementOutput(output)
  }

  public async invokeStructured<T>(input: ClaudeStructuredInput): Promise<T> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const queryOptions = {
      allowDangerouslySkipPermissions: true,
      cwd: this.options.workspaceRoot,
      permissionMode: 'bypassPermissions',
      outputFormat: {
        schema: input.outputSchema,
        type: 'json_schema',
      },
      ...(this.options.onEvent
        ? {
            agentProgressSummaries: true,
            includePartialMessages: true,
          }
        : {
            includePartialMessages: false,
          }),
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.effort ? { effort: this.options.effort } : {}),
    } satisfies ClaudeQueryOptions

    const messages = query({
      options: queryOptions,
      prompt: input.prompt,
    })

    return this.collectStructuredOutput(
      messages as AsyncIterable<QueryMessage>,
    ) as Promise<T>
  }

  public async review(input: ReviewAgentInput) {
    const prompt = await buildReviewerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: reviewOutputSchema,
      prompt,
    })
    return validateReviewOutput(output)
  }
}

export function createClaudeProvider(
  options: ClaudeAgentClientOptions,
): ImplementerProvider & ReviewerProvider {
  return new ClaudeAgentClient(options)
}
