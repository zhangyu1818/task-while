import {
  recordCommitFailure,
  recordImplementFailure,
  recordImplementSuccess,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
  startAttempt,
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
  ImplementArtifact,
  IntegrateArtifact,
  ReviewArtifact,
  TaskGraph,
  WorkflowState,
} from '../types'
import type { ReviewPhaseResult, WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export interface ExecuteTaskAttemptInput {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  taskHandle: string
  workflow: WorkflowRuntime
}

export interface ExecuteTaskAttemptResult {
  report: FinalReport
  state: WorkflowState
}

export async function executeTaskAttempt(
  input: ExecuteTaskAttemptInput,
): Promise<ExecuteTaskAttemptResult> {
  let state = startAttempt(input.graph, input.state, input.taskHandle)
  await appendEvent(input.runtime, {
    attempt: state.tasks[input.taskHandle]!.attempt,
    generation: state.tasks[input.taskHandle]!.generation,
    taskHandle: input.taskHandle,
    timestamp: now(),
    type: 'attempt_started',
  })
  let report = await persistState(input.runtime, input.graph, state)
  const taskState = state.tasks[input.taskHandle]!
  const taskHandle = input.taskHandle
  const commitMessage = input.runtime.taskSource.buildCommitSubject(taskHandle)
  let implementArtifact: ImplementArtifact | null = null
  let reviewArtifact: null | ReviewArtifact = null
  let implement
  try {
    const prompt = await input.runtime.taskSource.buildImplementPrompt({
      attempt: taskState.attempt,
      generation: taskState.generation,
      lastFindings: taskState.lastFindings,
      taskHandle,
    })
    implement = await input.workflow.roles.implementer.implement({
      attempt: taskState.attempt,
      generation: taskState.generation,
      lastFindings: taskState.lastFindings,
      prompt,
      taskHandle,
    })
    if (implement.taskHandle !== taskHandle) {
      throw new Error(
        `Implement taskHandle mismatch: expected ${taskHandle}, received ${implement.taskHandle}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    state = recordImplementFailure(input.graph, state, input.taskHandle, reason)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskHandle: input.taskHandle,
      timestamp: now(),
      type: 'implement_failed',
    })
    report = await persistState(input.runtime, input.graph, state)
    return { report, state }
  }
  implementArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: implement,
    taskHandle,
  }
  await input.runtime.store.saveImplementArtifact(implementArtifact)
  state = recordImplementSuccess(state, input.taskHandle)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskHandle: input.taskHandle,
    timestamp: now(),
    type: 'implement_succeeded',
  })
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskHandle: input.taskHandle,
    timestamp: now(),
    type: 'review_started',
  })
  report = await persistState(input.runtime, input.graph, state)
  let review
  let reviewPhaseKind: 'approved' | 'rejected'
  try {
    let reviewPhase: ReviewPhaseResult
    if (input.workflow.preset.mode === 'direct') {
      const actualChangedFiles =
        await input.runtime.git.getChangedFilesSinceHead()
      const prompt = await input.runtime.taskSource.buildReviewPrompt({
        actualChangedFiles,
        attempt: taskState.attempt,
        generation: taskState.generation,
        implement,
        lastFindings: taskState.lastFindings,
        taskHandle,
      })
      reviewPhase = await input.workflow.preset.review({
        actualChangedFiles,
        attempt: taskState.attempt,
        commitMessage,
        generation: taskState.generation,
        implement,
        lastFindings: taskState.lastFindings,
        prompt,
        taskHandle,
      })
    } else {
      const completionCriteria =
        await input.runtime.taskSource.getCompletionCriteria(taskHandle)
      reviewPhase = await input.workflow.preset.review({
        attempt: taskState.attempt,
        commitMessage,
        completionCriteria,
        runtime: input.runtime,
        taskHandle,
      })
    }
    reviewPhaseKind = reviewPhase.kind
    review = reviewPhase.review
    if (review.taskHandle !== taskHandle) {
      throw new Error(
        `Review taskHandle mismatch: expected ${taskHandle}, received ${review.taskHandle}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    state = recordReviewFailure(input.graph, state, input.taskHandle, reason)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskHandle: input.taskHandle,
      timestamp: now(),
      type: 'review_failed',
    })
    report = await persistState(input.runtime, input.graph, state)
    return { report, state }
  }
  reviewArtifact = {
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
    taskHandle: input.taskHandle,
    timestamp: now(),
    type: 'review_completed',
  })

  if (reviewPhaseKind === 'approved' && shouldPassZeroGate({ review })) {
    state = recordReviewApproved(state, input.taskHandle, review)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskHandle: input.taskHandle,
      timestamp: now(),
      type: 'integrate_started',
    })
    report = await persistState(input.runtime, input.graph, state)

    let integrateResult
    try {
      integrateResult = await input.workflow.preset.integrate({
        commitMessage,
        runtime: input.runtime,
        taskHandle,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      state = recordCommitFailure(input.graph, state, input.taskHandle, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskHandle: input.taskHandle,
        timestamp: now(),
        type: 'integrate_failed',
      })
      report = await persistState(input.runtime, input.graph, state)
      return { report, state }
    }
    const integrateArtifact: IntegrateArtifact = {
      attempt: taskState.attempt,
      createdAt: now(),
      generation: taskState.generation,
      result: integrateResult.result,
      taskHandle,
    }
    state = recordIntegrateResult(input.graph, state, taskHandle, {
      commitSha: integrateResult.result.commitSha,
      review,
    })
    report = await persistState(input.runtime, input.graph, state)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: integrateResult.result.summary,
      generation: taskState.generation,
      taskHandle: input.taskHandle,
      timestamp: now(),
      type: 'integrate_completed',
    })
    await input.runtime.store.saveIntegrateArtifact(integrateArtifact)
    await persistCommittedArtifacts(input.runtime, {
      commitSha: integrateResult.result.commitSha,
      implementArtifact,
      reviewArtifact,
    })
    return { report, state }
  }
  state = recordReviewResult(input.graph, state, input.taskHandle, {
    review,
  })
  report = await persistState(input.runtime, input.graph, state)
  return { report, state }
}
