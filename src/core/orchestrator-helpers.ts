import {
  buildReport,
  recordCommitFailure,
  recordIntegrateResult,
  recordReviewApproved,
} from './engine'

import type {
  FinalReport,
  ImplementArtifact,
  ReviewArtifact,
  ReviewOutput,
  TaskGraph,
  WorkflowEvent,
  WorkflowState,
} from '../types'
import type { OrchestratorRuntime } from './runtime'

export function now() {
  return new Date().toISOString()
}

export async function persistState(
  runtime: OrchestratorRuntime,
  graph: TaskGraph,
  state: WorkflowState,
) {
  await runtime.store.saveState(state)
  const report = buildReport(graph, state, now())
  await runtime.store.saveReport(report)
  return report
}

export async function appendEvent(
  runtime: OrchestratorRuntime,
  event: WorkflowEvent,
) {
  await runtime.store.appendEvent(event)
}

export function createTaskCommitMessage(taskId: string, title: string) {
  return `Task ${taskId}: ${title}`
}

export interface FinalizePassedTaskInput {
  graph: TaskGraph
  review: ReviewOutput
  runtime: OrchestratorRuntime
  state: WorkflowState
  taskId: string
  taskTitle: string
}

export async function finalizePassedTask(input: FinalizePassedTaskInput) {
  const integratingState = recordReviewApproved(
    input.state,
    input.taskId,
    input.review,
  )
  let taskChecked = false
  try {
    await input.runtime.workspace.updateTaskChecks([
      { checked: true, taskId: input.taskId },
    ])
    taskChecked = true
    const { commitSha } = await input.runtime.git.commitTask({
      message: createTaskCommitMessage(input.taskId, input.taskTitle),
    })
    return {
      commitSha,
      state: recordIntegrateResult(
        input.graph,
        integratingState,
        input.taskId,
        {
          commitSha,
          review: input.review,
        },
      ),
    }
  } catch (error) {
    let reason = `Task commit failed: ${error instanceof Error ? error.message : String(error)}`
    if (taskChecked) {
      try {
        await input.runtime.workspace.updateTaskChecks([
          { checked: false, taskId: input.taskId },
        ])
      } catch (rollbackError) {
        reason = `${reason}; checkbox rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      }
    }
    return {
      state: recordCommitFailure(
        input.graph,
        integratingState,
        input.taskId,
        reason,
      ),
    }
  }
}

export async function persistCommittedArtifacts(
  runtime: OrchestratorRuntime,
  input: PersistCommittedArtifactsInput,
) {
  await runtime.store.saveImplementArtifact({
    ...input.implementArtifact,
    commitSha: input.commitSha,
  })
  await runtime.store.saveReviewArtifact({
    ...input.reviewArtifact,
    commitSha: input.commitSha,
  })
}

export type WorkflowSummary = FinalReport['summary']

export interface PersistCommittedArtifactsInput {
  commitSha: string
  implementArtifact: ImplementArtifact
  reviewArtifact: ReviewArtifact
}
