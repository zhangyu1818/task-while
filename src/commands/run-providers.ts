import { createClaudeProvider } from '../agents/claude'
import { createCodexProvider } from '../agents/codex'
import {
  createClaudeEventHandler,
  createCodexEventHandler,
} from '../agents/event-log'
import { providerOptionsCacheKey } from '../agents/provider-options'
import { createCodexRemoteReviewerProvider } from '../workflow/remote-reviewer'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
  ReviewerProvider,
} from '../agents/types'
import type { WorkspaceContext } from '../types'
import type { WorkflowProvider, WorkflowRoleConfig } from '../workflow/config'

export type ProviderResolver = (
  role: WorkflowRoleConfig,
) => ImplementerProvider & ReviewerProvider

export type RemoteReviewerResolver = (
  providerName: WorkflowProvider,
) => RemoteReviewerProvider

export function createProviderResolver(
  context: WorkspaceContext,
  verbose: boolean | undefined,
): ProviderResolver {
  const cache = new Map<string, ImplementerProvider & ReviewerProvider>()
  return (role: WorkflowRoleConfig) => {
    const cacheKey = providerOptionsCacheKey(role)
    const cached = cache.get(cacheKey)
    if (cached) {
      return cached
    }
    let provider: ImplementerProvider & ReviewerProvider
    if (role.provider === 'claude') {
      const onEvent = createClaudeEventHandler(verbose)
      provider = createClaudeProvider({
        ...(role.effort ? { effort: role.effort } : {}),
        ...(role.model ? { model: role.model } : {}),
        ...(role.timeout ? { timeout: role.timeout } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    } else {
      const onEvent = createCodexEventHandler(verbose)
      provider = createCodexProvider({
        ...(role.effort ? { effort: role.effort } : {}),
        ...(role.model ? { model: role.model } : {}),
        ...(role.timeout ? { timeout: role.timeout } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    }
    cache.set(cacheKey, provider)
    return provider
  }
}

export function createRemoteReviewerResolver(): RemoteReviewerResolver {
  const cache = new Map<WorkflowProvider, RemoteReviewerProvider>()
  return (providerName: WorkflowProvider) => {
    const cached = cache.get(providerName)
    if (cached) {
      return cached
    }
    if (providerName === 'claude') {
      throw new Error(
        'claude remote reviewer is not implemented in pull-request mode',
      )
    }
    const provider = createCodexRemoteReviewerProvider()
    cache.set(providerName, provider)
    return provider
  }
}
