import { ClaudeAgentClient } from '../agents/claude'
import { CodexAgentClient } from '../agents/codex'
import {
  createClaudeEventHandler,
  createCodexEventHandler,
} from '../agents/event-log'

import type { WorkflowRoleProviderOptions } from '../agents/provider-options'

export interface AgentInvocation {
  outputSchema: Record<string, unknown>
  prompt: string
}

export interface AgentPort {
  execute: (invocation: AgentInvocation) => Promise<unknown>
  name: string
}

export interface CreateAgentPortContext {
  verbose?: boolean | undefined
  workspaceRoot: string
}

export function createAgentPort(
  input: WorkflowRoleProviderOptions,
  context: CreateAgentPortContext,
): AgentPort {
  if (input.provider === 'claude') {
    const onEvent = createClaudeEventHandler(context.verbose)
    const client = new ClaudeAgentClient({
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.timeout ? { timeout: input.timeout } : {}),
      ...(onEvent ? { onEvent } : {}),
      workspaceRoot: context.workspaceRoot,
    })
    return {
      name: client.name,
      async execute(invocation: AgentInvocation) {
        return client.invokeStructured<unknown>(invocation)
      },
    }
  }

  const onEvent = createCodexEventHandler(context.verbose)
  const client = new CodexAgentClient({
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.timeout ? { timeout: input.timeout } : {}),
    ...(onEvent ? { onEvent } : {}),
    workspaceRoot: context.workspaceRoot,
  })
  return {
    name: client.name,
    async execute(invocation: AgentInvocation) {
      return client.invokeStructured<unknown>(invocation)
    },
  }
}
