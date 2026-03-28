import {
  isPullRequestWorkflowPreset,
  type WorkflowRuntime,
} from '../workflow/preset'
import {
  recordCommitFailure,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
} from './engine'
import { shouldPassZeroGate } from './engine-helpers'
import {
  appendEvent,
  now,
  persistCommittedArtifacts,
  persistState,
} from './orchestrator-helpers'

import type {
  FinalReport,
  IntegrateArtifact,
  ReviewArtifact,
  TaskGraph,
  WorkflowState,
} from '../types'
import type { OrchestratorRuntime } from './runtime'

export interface ResumePullRequestReviewInput {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  workflow: WorkflowRuntime
}

export interface ResumePullRequestReviewResult {
  report: FinalReport
  state: WorkflowState
}

export async function resumePullRequestReview(
  input: ResumePullRequestReviewInput,
): Promise<null | ResumePullRequestReviewResult> {
  const preset = input.workflow.preset
  if (!isPullRequestWorkflowPreset(preset) || !input.state.currentTaskHandle) {
    return null
  }

  const taskHandle = input.state.currentTaskHandle
  const taskState = input.state.tasks[taskHandle]
  if (taskState?.status !== 'running' || taskState.stage !== 'review') {
    return null
  }

  const artifactKey = {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskHandle,
  }
  const implementArtifact =
    await input.runtime.store.loadImplementArtifact(artifactKey)

  if (!implementArtifact) {
    const reason = `Cannot resume review for ${taskHandle} without a persisted implement artifact`
    const nextState = recordReviewFailure(
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
      type: 'review_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const commitMessage = input.runtime.taskSource.buildCommitSubject(taskHandle)
  let review
  let reviewPhaseKind: 'approved' | 'rejected'

  try {
    const completionCriteria =
      await input.runtime.taskSource.getCompletionCriteria(taskHandle)
    const reviewPhase = await preset.review({
      attempt: taskState.attempt,
      commitMessage,
      completionCriteria,
      runtime: input.runtime,
      taskHandle,
    })
    reviewPhaseKind = reviewPhase.kind
    review = reviewPhase.review
    if (review.taskHandle !== taskHandle) {
      throw new Error(
        `Review taskHandle mismatch: expected ${taskHandle}, received ${review.taskHandle}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const nextState = recordReviewFailure(
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
      type: 'review_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const reviewArtifact: ReviewArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: review,
    taskHandle,
  }
  await input.runtime.store.saveReviewArtifact(reviewArtifact)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    detail: review.summary,
    generation: taskState.generation,
    taskHandle,
    timestamp: now(),
    type: 'review_completed',
  })

  if (reviewPhaseKind === 'approved' && shouldPassZeroGate({ review })) {
    let nextState = recordReviewApproved(input.state, taskHandle, review)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskHandle,
      timestamp: now(),
      type: 'integrate_started',
    })
    let report = await persistState(input.runtime, input.graph, nextState)

    let integrateResult
    try {
      integrateResult = await input.workflow.preset.integrate({
        commitMessage,
        runtime: input.runtime,
        taskHandle,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      nextState = recordCommitFailure(
        input.graph,
        nextState,
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
      report = await persistState(input.runtime, input.graph, nextState)
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
    nextState = recordIntegrateResult(input.graph, nextState, taskHandle, {
      commitSha: integrateResult.result.commitSha,
      review,
    })
    report = await persistState(input.runtime, input.graph, nextState)
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

  const nextState = recordReviewResult(input.graph, input.state, taskHandle, {
    review,
  })
  const report = await persistState(input.runtime, input.graph, nextState)
  return {
    report,
    state: nextState,
  }
}
