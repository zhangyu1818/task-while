import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema/index'

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

export interface ClaudeAssistantEvent {
  type: 'assistant'
}

export interface ClaudeResultEvent {
  type: 'result'
}

export interface ClaudeErrorEvent {
  message: string
  type: 'error'
}

export type ClaudeAgentEvent =
  | ClaudeAssistantEvent
  | ClaudeErrorEvent
  | ClaudeResultEvent
  | ClaudeTextEvent

export type ClaudeAgentEventHandler = (event: ClaudeAgentEvent) => void

interface QueryResultMessage {
  errors?: string[]
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

type QueryMessage =
  | QueryAssistantMessage
  | QueryResultMessage
  | QueryStreamEventMessage

export interface ClaudeAgentClientOptions {
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

      if (message.type === 'assistant' && this.options.onEvent) {
        this.options.onEvent({ type: 'assistant' })
      }

      if (message.type === 'result') {
        if (message.subtype !== 'success') {
          const detail = message.errors?.join('; ') ?? message.subtype
          throw new Error(`Claude agent query failed: ${detail}`)
        }
        structuredOutput = message.structured_output ?? null
        if (this.options.onEvent) {
          this.options.onEvent({ type: 'result' })
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

    const messages = query({
      prompt: input.prompt,
      options: {
        allowDangerouslySkipPermissions: true,
        cwd: this.options.workspaceRoot,
        includePartialMessages: !!this.options.onEvent,
        permissionMode: 'bypassPermissions',
        outputFormat: {
          schema: input.outputSchema,
          type: 'json_schema',
        },
      },
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
