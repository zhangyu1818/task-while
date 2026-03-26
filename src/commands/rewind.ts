import { rewindTask } from '../core/orchestrator'
import { normalizeTaskGraph } from '../core/task-normalizer'
import { createOrchestratorRuntime } from '../runtime/fs-runtime'

import type { WorkspaceContext } from '../types'

export async function rewindCommand(context: WorkspaceContext, taskId: string) {
  const runtime = createOrchestratorRuntime({
    featureDir: context.featureDir,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  return rewindTask({
    runtime,
    taskId,
    loadGraph: () =>
      normalizeTaskGraph({
        featureDir: context.featureDir,
        tasksPath: context.tasksPath,
      }),
  })
}
