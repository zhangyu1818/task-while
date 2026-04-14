import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema/index'
import { withAbortTimeout } from './timeout'

import type { CodexProviderOptions } from './provider-options'
import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from './types'

export interface CodexRunResult {
  finalResponse: string
}

export interface CodexUsage {
  cached_input_tokens: number
  input_tokens: number
  output_tokens: number
}

export interface CodexTurnFailedEvent {
  error: CodexTurnFailedError
  type: 'turn.failed'
}

export interface CodexItemEvent {
  item: CodexItemPayload
  type: 'item.completed' | 'item.started' | 'item.updated'
}

export interface CodexErrorEvent {
  message: string
  type: 'error'
}

export interface CodexThreadStartedEvent {
  thread_id: string
  type: 'thread.started'
}

export interface CodexTurnCompletedEvent {
  type: 'turn.completed'
  usage: CodexUsage
}

export interface CodexTurnStartedEvent {
  type: 'turn.started'
}

export interface CodexTurnFailedError {
  message: string
}

export interface CodexAgentMessageItem {
  id: string
  text: string
  type: 'agent_message'
}

export interface CodexReasoningItem {
  id: string
  text: string
  type: 'reasoning'
}

export interface CodexCommandExecutionItem {
  aggregated_output: string
  command: string
  exit_code?: number
  id: string
  status: 'completed' | 'failed' | 'in_progress'
  type: 'command_execution'
}

export interface CodexFileChangeItem {
  changes: { kind: 'add' | 'delete' | 'update'; path: string }[]
  id: string
  status: 'completed' | 'failed'
  type: 'file_change'
}

export interface CodexMcpToolCallItem {
  arguments: unknown
  error?: { message: string }
  id: string
  result?: {
    structured_content: unknown
  }
  server: string
  status: 'completed' | 'failed' | 'in_progress'
  tool: string
  type: 'mcp_tool_call'
}

export interface CodexWebSearchItem {
  id: string
  query: string
  type: 'web_search'
}

export interface CodexTodoListItem {
  id: string
  items: { completed: boolean; text: string }[]
  type: 'todo_list'
}

export interface CodexErrorItem {
  id: string
  message: string
  type: 'error'
}

export type CodexItemPayload =
  | CodexAgentMessageItem
  | CodexCommandExecutionItem
  | CodexErrorItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexReasoningItem
  | CodexTodoListItem
  | CodexWebSearchItem

export type CodexThreadEvent =
  | CodexErrorEvent
  | CodexItemEvent
  | CodexThreadStartedEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent
  | CodexTurnStartedEvent

export type CodexThreadEventHandler = (event: CodexThreadEvent) => void

export interface CodexRunStreamedResult {
  events: AsyncGenerator<CodexThreadEvent>
}

export interface CodexThreadRunOptions {
  outputSchema: Record<string, unknown>
  signal?: AbortSignal
}

export interface CodexThreadLike {
  run: (
    prompt: string,
    options: CodexThreadRunOptions,
  ) => Promise<CodexRunResult>
  runStreamed?: (
    prompt: string,
    options: CodexThreadRunOptions,
  ) => Promise<CodexRunStreamedResult>
}

export interface CodexStartThreadOptions {
  model?: string
  modelReasoningEffort?: 'high' | 'low' | 'medium' | 'minimal' | 'xhigh'
  workingDirectory: string
}

export interface CodexClientLike {
  startThread: (options: CodexStartThreadOptions) => CodexThreadLike
}

export interface CodexAgentClientOptions extends CodexProviderOptions {
  onEvent?: CodexThreadEventHandler
  workspaceRoot: string
}

export interface CodexStructuredInput {
  outputSchema: Record<string, unknown>
  prompt: string
}

async function defaultClientFactory(): Promise<CodexClientLike> {
  const { Codex } = await import('@openai/codex-sdk')
  return new Codex()
}

export class CodexAgentClient implements ImplementerProvider, ReviewerProvider {
  private clientPromise: null | Promise<CodexClientLike> = null
  public readonly name = 'codex'

  public constructor(private readonly options: CodexAgentClientOptions) {}

  private async collectStreamedTurn<T>(
    thread: CodexThreadLike,
    input: CodexStructuredInput,
    signal?: AbortSignal,
  ): Promise<T> {
    const streamedTurn = await thread.runStreamed!(input.prompt, {
      outputSchema: input.outputSchema,
      ...(signal ? { signal } : {}),
    })
    let finalResponse = ''

    for await (const event of streamedTurn.events) {
      this.options.onEvent?.(event)

      if (event.type === 'error') {
        throw new Error(event.message)
      }

      if (event.type === 'turn.failed') {
        throw new Error(event.error.message)
      }

      if (
        event.type === 'item.completed' &&
        event.item.type === 'agent_message'
      ) {
        finalResponse = event.item.text.trim()
      }
    }

    if (!finalResponse) {
      throw new Error('Codex agent client returned empty finalResponse')
    }

    try {
      return JSON.parse(finalResponse) as T
    } catch (error) {
      throw new Error('Codex agent client returned non-JSON finalResponse', {
        cause: error,
      })
    }
  }

  private async getClient(): Promise<CodexClientLike> {
    this.clientPromise ??= defaultClientFactory()
    return this.clientPromise
  }

  public async implement(input: ImplementAgentInput) {
    const prompt = await buildImplementerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: implementOutputSchema,
      prompt,
    })
    return validateImplementOutput(output)
  }

  public async invokeStructured<T>(input: CodexStructuredInput): Promise<T> {
    const client = await this.getClient()
    const startThreadOptions: CodexStartThreadOptions = {
      workingDirectory: this.options.workspaceRoot,
    }

    if (this.options.model) {
      startThreadOptions.model = this.options.model
    }

    if (this.options.effort) {
      startThreadOptions.modelReasoningEffort = this.options.effort
    }

    const thread = client.startThread(startThreadOptions)

    if (this.options.onEvent && thread.runStreamed) {
      return withAbortTimeout(this.name, this.options.timeout, (controller) =>
        this.collectStreamedTurn<T>(thread, input, controller?.signal),
      )
    }
    return withAbortTimeout(
      this.name,
      this.options.timeout,
      async (controller) => {
        const turn = await thread.run(input.prompt, {
          outputSchema: input.outputSchema,
          ...(controller ? { signal: controller.signal } : {}),
        })
        const response = turn.finalResponse.trim()
        if (!response) {
          throw new Error('Codex agent client returned empty finalResponse')
        }
        try {
          return JSON.parse(response) as T
        } catch (error) {
          throw new Error(
            'Codex agent client returned non-JSON finalResponse',
            {
              cause: error,
            },
          )
        }
      },
    )
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
