import {
  createClaudeProvider,
  type ClaudeAgentEvent,
  type ClaudeAgentEventHandler,
} from '../agents/claude'
import {
  createCodexProvider,
  type CodexThreadEvent,
  type CodexThreadEventHandler,
} from '../agents/codex'
import { providerOptionsEqual } from '../agents/provider-options'
import { runWorkflow, type WorkflowRunResult } from '../core/orchestrator'
import { buildTaskTopology } from '../core/task-topology'
import { createOrchestratorRuntime } from '../runtime/fs-runtime'
import { openTaskSource } from '../task-sources/registry'
import {
  loadWorkflowConfig,
  type WorkflowConfig,
  type WorkflowProvider,
  type WorkflowRoleConfig,
} from '../workflow/config'
import {
  createDirectWorkflowPreset,
  createPullRequestWorkflowPreset,
  type WorkflowRuntime,
} from '../workflow/preset'
import { createCodexRemoteReviewerProvider } from '../workflow/remote-reviewer'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
  ReviewerProvider,
  WorkflowRoleProviders,
} from '../agents/types'
import type { WorkspaceContext } from '../types'

export interface RunCommandOptions {
  config?: WorkflowConfig
  untilTaskId?: string
  verbose?: boolean
}

export type WorkflowExecutionRunner = () => Promise<WorkflowRunResult>

export interface WorkflowExecution {
  config: WorkflowConfig
  execute: WorkflowExecutionRunner
  workflow: WorkflowRuntime
}

export interface ResolveWorkflowRuntimeInput {
  config: WorkflowConfig
  context: WorkspaceContext
  options: RunCommandOptions
}

export type ProviderResolver = (
  role: WorkflowRoleConfig,
) => ImplementerProvider & ReviewerProvider

export type RemoteReviewerResolver = (
  providerName: WorkflowProvider,
) => RemoteReviewerProvider

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

function createCodexEventHandler(
  verbose: boolean | undefined,
): CodexThreadEventHandler | undefined {
  if (!verbose) {
    return undefined
  }
  return writeCodexEvent
}

function writeClaudeEvent(event: ClaudeAgentEvent) {
  const detail = event.type === 'text' ? ` ${event.delta}` : ''
  process.stderr.write(`[claude] ${event.type}${detail}\n`)
}

function createClaudeEventHandler(
  verbose: boolean | undefined,
): ClaudeAgentEventHandler | undefined {
  if (!verbose) {
    return undefined
  }
  return writeClaudeEvent
}

function createProviderResolver(
  context: WorkspaceContext,
  verbose: boolean | undefined,
): ProviderResolver {
  const cache = new Map<
    WorkflowProvider,
    ImplementerProvider & ReviewerProvider
  >()
  return (role: WorkflowRoleConfig) => {
    const cached = cache.get(role.provider)
    if (cached) {
      return cached
    }
    let provider: ImplementerProvider & ReviewerProvider
    if (role.provider === 'claude') {
      const onEvent = createClaudeEventHandler(verbose)
      provider = createClaudeProvider({
        ...(role.effort ? { effort: role.effort } : {}),
        ...(role.model ? { model: role.model } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    } else {
      const onEvent = createCodexEventHandler(verbose)
      provider = createCodexProvider({
        ...(role.effort ? { effort: role.effort } : {}),
        ...(role.model ? { model: role.model } : {}),
        workspaceRoot: context.workspaceRoot,
        ...(onEvent ? { onEvent } : {}),
      })
    }
    cache.set(role.provider, provider)
    return provider
  }
}

function createRemoteReviewerResolver(): RemoteReviewerResolver {
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

function resolveWorkflowRuntime(
  input: ResolveWorkflowRuntimeInput,
): WorkflowRuntime {
  const resolveProvider = createProviderResolver(
    input.context,
    input.options.verbose,
  )
  const implementerRole = input.config.workflow.roles.implementer
  const reviewerRole = input.config.workflow.roles.reviewer

  if (input.config.workflow.mode === 'pull-request') {
    const resolveRemoteReviewer = createRemoteReviewerResolver()
    const reviewer = resolveRemoteReviewer(reviewerRole.provider)
    const implementer = resolveProvider(implementerRole)
    const roles: WorkflowRoleProviders = {
      implementer,
      reviewer,
    }

    return {
      roles,
      preset: createPullRequestWorkflowPreset({
        reviewer,
      }),
    }
  }

  if (
    implementerRole.provider === reviewerRole.provider &&
    !providerOptionsEqual(implementerRole, reviewerRole)
  ) {
    throw new Error(
      `direct workflow roles implementer and reviewer must use matching model and effort when sharing provider ${implementerRole.provider}`,
    )
  }

  const implementer = resolveProvider(implementerRole)
  const reviewer = resolveProvider(reviewerRole)
  const roles: WorkflowRoleProviders = {
    implementer,
    reviewer,
  }

  return {
    roles,
    preset: createDirectWorkflowPreset({
      reviewer,
    }),
  }
}

export async function loadWorkflowExecution(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
): Promise<WorkflowExecution> {
  const config =
    options.config ?? (await loadWorkflowConfig(context.workspaceRoot))
  const workflow = resolveWorkflowRuntime({
    config,
    context,
    options,
  })
  const taskSource = await openTaskSource(config.task.source, {
    featureDir: context.featureDir,
    featureId: context.featureId,
    workspaceRoot: context.workspaceRoot,
  })
  const runtime = createOrchestratorRuntime({
    featureDir: context.featureDir,
    taskSource,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  const graph = buildTaskTopology(
    taskSource,
    context.featureId,
    config.task.maxIterations,
  )
  const untilTaskHandle = options.untilTaskId
    ? taskSource.resolveTaskSelector(options.untilTaskId)
    : undefined
  const workflowInput = {
    graph,
    runtime,
    workflow,
    ...(untilTaskHandle ? { untilTaskHandle } : {}),
  }

  return {
    config,
    workflow,
    async execute() {
      return runWorkflow(workflowInput)
    },
  }
}

export async function runCommand(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
) {
  const execution = await loadWorkflowExecution(context, options)
  return execution.execute()
}
