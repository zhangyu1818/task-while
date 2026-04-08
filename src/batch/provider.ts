import { ClaudeAgentClient } from '../agents/claude'
import { CodexAgentClient } from '../agents/codex'
import {
  createClaudeEventHandler,
  createCodexEventHandler,
} from '../agents/event-log'

import type { WorkflowRoleProviderOptions } from '../agents/provider-options'

export interface BatchFileInput {
  content: string
  filePath: string
  outputSchema: Record<string, unknown>
  prompt: string
}

export interface BatchStructuredOutputProvider {
  readonly name: string
  runFile: (input: BatchFileInput) => Promise<unknown>
}

export type CreateBatchStructuredOutputProviderInput =
  WorkflowRoleProviderOptions & {
    verbose?: boolean
    workspaceRoot: string
  }

function buildBatchPrompt(input: BatchFileInput) {
  return [
    'Process exactly one file and return structured output only.',
    input.prompt,
    `File path: ${input.filePath}`,
    'File content:',
    input.content,
  ].join('\n\n')
}

class CodexBatchStructuredOutputProvider implements BatchStructuredOutputProvider {
  public readonly name = 'codex'

  public constructor(private readonly client: CodexAgentClient) {}

  public async runFile(input: BatchFileInput) {
    return this.client.invokeStructured<unknown>({
      outputSchema: input.outputSchema,
      prompt: buildBatchPrompt(input),
    })
  }
}

class ClaudeBatchStructuredOutputProvider implements BatchStructuredOutputProvider {
  public readonly name = 'claude'

  public constructor(private readonly client: ClaudeAgentClient) {}

  public async runFile(input: BatchFileInput) {
    return this.client.invokeStructured<unknown>({
      outputSchema: input.outputSchema,
      prompt: buildBatchPrompt(input),
    })
  }
}

export function createBatchStructuredOutputProvider(
  input: CreateBatchStructuredOutputProviderInput,
): BatchStructuredOutputProvider {
  if (input.provider === 'codex') {
    const onEvent = createCodexEventHandler(input.verbose)
    return new CodexBatchStructuredOutputProvider(
      new CodexAgentClient({
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(onEvent ? { onEvent } : {}),
        workspaceRoot: input.workspaceRoot,
      }),
    )
  }

  const onEvent = createClaudeEventHandler(input.verbose)
  return new ClaudeBatchStructuredOutputProvider(
    new ClaudeAgentClient({
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(onEvent ? { onEvent } : {}),
      workspaceRoot: input.workspaceRoot,
    }),
  )
}
