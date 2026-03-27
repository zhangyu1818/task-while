import {
  isPullRequestWorkflowPreset,
  type WorkflowRuntime,
} from '../workflow/preset'
import { recordCommitFailure, recordIntegrateResult } from './engine'
import {
  appendEvent,
  now,
  persistCommittedArtifacts,
  persistState,
} from './orchestrator-helpers'

import type {
  FinalReport,
  IntegrateArtifact,
  TaskGraph,
  WorkflowState,
} from '../types'
import type { OrchestratorRuntime } from './runtime'

export interface ResumePullRequestIntegrateInput {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  workflow: WorkflowRuntime
}

export interface ResumePullRequestIntegrateResult {
  report: FinalReport
  state: WorkflowState
}

export async function resumePullRequestIntegrate(
  input: ResumePullRequestIntegrateInput,
): Promise<null | ResumePullRequestIntegrateResult> {
  if (
    !isPullRequestWorkflowPreset(input.workflow.preset) ||
    !input.state.currentTaskHandle
  ) {
    return null
  }

  const taskHandle = input.state.currentTaskHandle
  const taskState = input.state.tasks[taskHandle]
  if (taskState?.status !== 'running' || taskState.stage !== 'integrate') {
    return null
  }

  const artifactKey = {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskHandle,
  }
  const [implementArtifact, reviewArtifact] = await Promise.all([
    input.runtime.store.loadImplementArtifact(artifactKey),
    input.runtime.store.loadReviewArtifact(artifactKey),
  ])

  if (!implementArtifact || !reviewArtifact) {
    const reason = `Cannot resume integrate for ${taskHandle} without persisted implement and review artifacts`
    const nextState = recordCommitFailure(
      input.graph,
      input.state,
      taskHandle,
      reason,
    )
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskHandle,
      timestamp: now(),
      type: 'integrate_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const commitMessage = input.runtime.taskSource.buildCommitSubject(taskHandle)

  let integrateResult
  try {
    integrateResult = await input.workflow.preset.integrate({
      commitMessage,
      runtime: input.runtime,
      taskHandle,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const nextState = recordCommitFailure(
      input.graph,
      input.state,
      taskHandle,
      reason,
    )
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskHandle,
      timestamp: now(),
      type: 'integrate_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const integrateArtifact: IntegrateArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: integrateResult.result,
    taskHandle,
  }
  const nextState = recordIntegrateResult(
    input.graph,
    input.state,
    taskHandle,
    {
      commitSha: integrateResult.result.commitSha,
      review: reviewArtifact.result,
    },
  )
  const report = await persistState(input.runtime, input.graph, nextState)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    detail: integrateResult.result.summary,
    generation: taskState.generation,
    taskHandle,
    timestamp: now(),
    type: 'integrate_completed',
  })
  await input.runtime.store.saveIntegrateArtifact(integrateArtifact)
  await persistCommittedArtifacts(input.runtime, {
    commitSha: integrateResult.result.commitSha,
    implementArtifact,
    reviewArtifact,
  })
  return {
    report,
    state: nextState,
  }
}
