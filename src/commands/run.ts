import { createFsHarnessStore } from '../adapters/fs/harness-store'
import { providerOptionsEqual } from '../agents/provider-options'
import { createRuntimePorts } from '../core/create-runtime-ports'
import { buildTaskTopology } from '../core/task-topology'
import { runKernel } from '../harness/kernel'
import { createRunDirectProgram } from '../programs/run-direct'
import { createRunPrProgram } from '../programs/run-pr'
import { createRuntimePaths } from '../runtime/path-layout'
import { createRunGraphScheduler } from '../schedulers/scheduler'
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

  const ports = createRuntimePorts({
    config,
    context,
    taskSource,
    verbose: options.verbose,
  })

  await ports.git.requireCleanWorktree()

  const topology = buildTaskTopology(
    taskSource,
    context.featureId,
    config.task.maxIterations,
  )

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
      `direct workflow roles implementer and reviewer must use matching model and effort when sharing provider ${implementerRole.provider}`,
    )
  }

  const protocol = isPullRequest ? 'run-pr' : 'run-direct'
  const store = createFsHarnessStore(
    createRuntimePaths(context.featureDir).runtimeDir,
  )

  const implementer = ports.resolveAgent(implementerRole)
  const reviewer = ports.resolveAgent(reviewerRole)

  const program =
    protocol === 'run-pr'
      ? createRunPrProgram({
          implementer,
          maxIterations: config.task.maxIterations,
          ports,
          reviewer,
          verifyCommands: config.verify.commands,
          workspaceRoot: context.workspaceRoot,
        })
      : createRunDirectProgram({
          implementer,
          maxIterations: config.task.maxIterations,
          ports,
          reviewer,
          verifyCommands: config.verify.commands,
          workspaceRoot: context.workspaceRoot,
        })

  const untilTaskHandle = options.untilTaskId
    ? taskSource.resolveTaskSelector(options.untilTaskId)
    : undefined

  const scheduler = createRunGraphScheduler({
    protocol,
    store,
    graph: topology.tasks.map((t) => ({
      dependsOn: t.dependsOn,
      subjectId: t.handle,
    })),
    ...(untilTaskHandle ? { untilTaskHandle } : {}),
  })

  for await (const event of runSession({
    config: {},
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
  const totalTasks = topology.tasks.length
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
