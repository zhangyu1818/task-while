import {
  createClaudeProvider,
  type ClaudeAgentClientOptions,
} from '../agents/claude'
import {
  createCodexProvider,
  type CodexAgentClientOptions,
} from '../agents/codex'
import {
  createClaudeEventHandler,
  createCodexEventHandler,
} from '../agents/event-log'
import { providerOptionsCacheKey } from '../agents/provider-options'
import { GitRuntime } from '../runtime/git'
import { GitHubRuntime } from '../runtime/github'
import { createRuntimePaths } from '../runtime/path-layout'

import type { ImplementerProvider } from '../agents/types'
import type { AgentPort } from '../ports/agent'
import type { TaskSourceSession } from '../task-sources/types'
import type { WorkspaceContext } from '../types'
import type { WorkflowConfig } from '../workflow/config'
import type { AgentRoleConfig, RuntimePorts } from './runtime'

interface InvokeCapable {
  invokeStructured: <T>(input: {
    outputSchema: Record<string, unknown>
    prompt: string
  }) => Promise<T>
}

function hasInvokeStructured(
  provider: ImplementerProvider,
): provider is ImplementerProvider & InvokeCapable {
  return (
    'invokeStructured' in provider &&
    typeof provider.invokeStructured === 'function'
  )
}

export interface CreateRuntimePortsInput {
  config: WorkflowConfig
  context: WorkspaceContext
  taskSource: TaskSourceSession
  verbose?: boolean | undefined
}

export function createRuntimePorts(
  input: CreateRuntimePortsInput,
): RuntimePorts {
  const { context, taskSource, verbose } = input
  const runtimePaths = createRuntimePaths(context.featureDir)
  const git = new GitRuntime(context.workspaceRoot, runtimePaths.runtimeDir)
  const codeHost = new GitHubRuntime(context.workspaceRoot)
  const agentCache = new Map<string, AgentPort>()

  function resolveAgent(role: AgentRoleConfig): AgentPort {
    const key = providerOptionsCacheKey(role)
    const cached = agentCache.get(key)
    if (cached) {
      return cached
    }

    let provider: ImplementerProvider
    if (role.provider === 'claude') {
      const onEvent = createClaudeEventHandler(verbose)
      provider = createClaudeProvider({
        ...(role.effort
          ? {
              effort: role.effort as NonNullable<
                ClaudeAgentClientOptions['effort']
              >,
            }
          : {}),
        ...(role.model ? { model: role.model } : {}),
        ...(role.timeout ? { timeout: role.timeout } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    } else {
      const onEvent = createCodexEventHandler(verbose)
      provider = createCodexProvider({
        ...(role.effort
          ? {
              effort: role.effort as NonNullable<
                CodexAgentClientOptions['effort']
              >,
            }
          : {}),
        ...(role.model ? { model: role.model } : {}),
        ...(role.timeout ? { timeout: role.timeout } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    }

    if (!hasInvokeStructured(provider)) {
      throw new Error(
        `Provider ${role.provider} does not support invokeStructured`,
      )
    }

    const invoke = provider.invokeStructured.bind(provider)
    const agent: AgentPort = {
      name: provider.name,
      async execute(invocation) {
        return invoke(invocation)
      },
    }

    agentCache.set(key, agent)
    return agent
  }

  return {
    codeHost,
    git,
    resolveAgent,
    taskSource,
  }
}
