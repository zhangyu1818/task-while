import { createFsHarnessStore } from '../adapters/fs/harness-store'
import {
  providerOptionsCacheKey,
  providerOptionsEqual,
} from '../agents/provider-options'
import { runKernel } from '../harness/kernel'
import { createAgentPort } from '../ports/agent'
import { createRunDirectProgram } from '../programs/run-direct'
import { createRunPrProgram } from '../programs/run-pr'
import { GitRuntime } from '../runtime/git'
import { GitHubRuntime } from '../runtime/github'
import { createTaskQueueScheduler } from '../schedulers/scheduler'
import { runSession } from '../session/session'
import { openTaskSource } from '../task-sources/registry'
import { loadWorkflowConfig, type WorkflowConfig } from '../workflow/config'

import type { WorkspaceContext } from '../types'

export interface RunCommandOptions {
  config?: WorkflowConfig
  untilTaskId?: string
  verbose?: boolean
}

export interface RunCommandResult {
  summary: {
    blockedTasks: number
    completedTasks: number
    finalStatus: 'blocked' | 'completed' | 'in_progress' | 'replan_required'
    replanTasks: number
    totalTasks: number
  }
}

function assertUniqueTaskHandles(taskHandles: string[]) {
  const seen = new Set<string>()
  for (const taskHandle of taskHandles) {
    if (seen.has(taskHandle)) {
      throw new Error(`Duplicate task handle: ${taskHandle}`)
    }
    seen.add(taskHandle)
  }
}

export async function runCommand(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const config =
    options.config ?? (await loadWorkflowConfig(context.workspaceRoot))

  const taskSource = await openTaskSource(config.task.source, {
    featureDir: context.featureDir,
    featureId: context.featureId,
    workspaceRoot: context.workspaceRoot,
  })

  const taskHandles = [...taskSource.listTasks()]
  assertUniqueTaskHandles(taskHandles)

  const ports = {
    git: new GitRuntime(context.workspaceRoot, context.runtimeDir),
    github: new GitHubRuntime(context.workspaceRoot),
    taskSource,
  }

  await ports.git.requireCleanWorktree()

  const isPullRequest = config.workflow.mode === 'pull-request'
  const implementerRole = config.workflow.roles.implementer
  const reviewerRole = config.workflow.roles.reviewer

  if (isPullRequest && reviewerRole.provider === 'claude') {
    throw new Error(
      'claude remote reviewer is not implemented in pull-request mode',
    )
  }

  if (
    !isPullRequest &&
    implementerRole.provider === reviewerRole.provider &&
    !providerOptionsEqual(implementerRole, reviewerRole)
  ) {
    throw new Error(
      `direct workflow roles implementer and reviewer must use matching model, effort, and timeout when sharing provider ${implementerRole.provider}`,
    )
  }

  const agentCache = new Map<string, ReturnType<typeof createAgentPort>>()

  function resolveAgent(role: typeof implementerRole) {
    const cacheKey = providerOptionsCacheKey(role)
    const cached = agentCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const agent = createAgentPort(role, {
      ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
      workspaceRoot: context.workspaceRoot,
    })

    agentCache.set(cacheKey, agent)
    return agent
  }

  const protocol = isPullRequest ? 'run-pr' : 'run-direct'
  const store = createFsHarnessStore(context.runtimeDir)

  const implementer = resolveAgent(implementerRole)

  const program = isPullRequest
    ? createRunPrProgram({
        implementer,
        maxIterations: config.task.maxIterations,
        ports,
        verifyCommands: config.verify.commands,
        workspaceRoot: context.workspaceRoot,
      })
    : createRunDirectProgram({
        implementer,
        maxIterations: config.task.maxIterations,
        ports,
        reviewer: resolveAgent(reviewerRole),
        verifyCommands: config.verify.commands,
        workspaceRoot: context.workspaceRoot,
      })

  const untilTaskHandle = options.untilTaskId
    ? taskSource.resolveTaskSelector(options.untilTaskId)
    : undefined

  const scheduler = createTaskQueueScheduler({
    protocol,
    store,
    taskHandles,
    ...(untilTaskHandle ? { untilTaskHandle } : {}),
  })

  for await (const event of runSession({
    scheduler,
    kernel: {
      run: (subjectId) =>
        runKernel({
          config: { verify: config.verify, workflow: config.workflow },
          program,
          protocol,
          store,
          subjectId,
        }),
    },
  })) {
    void event
  }

  const sets = await scheduler.rebuild()
  const totalTasks = taskHandles.length
  const completedTasks = sets.done.size
  const blockedTasks = sets.blocked.size
  const replanTasks = sets.replan.size

  const finalStatus =
    replanTasks > 0
      ? ('replan_required' as const)
      : blockedTasks > 0
        ? ('blocked' as const)
        : completedTasks === totalTasks
          ? ('completed' as const)
          : ('in_progress' as const)

  return {
    summary: {
      blockedTasks,
      completedTasks,
      finalStatus,
      replanTasks,
      totalTasks,
    },
  }
}
