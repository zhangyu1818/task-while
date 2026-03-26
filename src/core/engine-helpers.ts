import type {
  PendingTaskState,
  ReviewFinding,
  ReviewOutput,
  ReviewVerdict,
  TaskDefinition,
  TaskGraph,
  TaskState,
  WorkflowState,
} from '../types'

export function cloneState(state: WorkflowState): WorkflowState {
  return structuredClone(state)
}

export function createBaseTaskState(): PendingTaskState {
  return {
    attempt: 0,
    generation: 1,
    invalidatedBy: null,
    lastFindings: [],
    status: 'pending',
  }
}

export function getTask(graph: TaskGraph, taskId: string): TaskDefinition {
  const task = graph.tasks.find((item) => item.id === taskId)
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`)
  }
  return task
}

export function getTaskState(state: WorkflowState, taskId: string): TaskState {
  const taskState = state.tasks[taskId]
  if (!taskState) {
    throw new Error(`Missing state for task ${taskId}`)
  }
  return taskState
}

export function canStartTask(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
) {
  const task = getTask(graph, taskId)
  return task.dependsOn.every(
    (dependency) => state.tasks[dependency]?.status === 'done',
  )
}

export function withReviewMetadata(
  taskState: TaskState,
  input: WithReviewMetadataInput,
) {
  const next = {
    attempt: taskState.attempt,
    generation: taskState.generation,
    invalidatedBy: taskState.invalidatedBy,
    lastFindings: taskState.lastFindings,
    ...(taskState.lastReviewVerdict
      ? { lastReviewVerdict: taskState.lastReviewVerdict }
      : {}),
  }
  if (input.findings) {
    next.lastFindings = input.findings
  }
  if (input.reviewVerdict) {
    next.lastReviewVerdict = input.reviewVerdict
  }
  return next
}

export interface WithReviewMetadataInput {
  findings?: ReviewFinding[]
  reviewVerdict?: ReviewVerdict
}

export interface ZeroGateInput {
  review: ReviewOutput
}

export function shouldPassZeroGate(input: ZeroGateInput) {
  return (
    input.review.verdict === 'pass' &&
    input.review.findings.length === 0 &&
    input.review.acceptanceChecks.every((check) => check.status === 'pass')
  )
}

export function collectDescendants(
  graph: TaskGraph,
  taskId: string,
  seen = new Set<string>(),
) {
  for (const task of graph.tasks) {
    if (task.dependsOn.includes(taskId) && !seen.has(task.id)) {
      seen.add(task.id)
      collectDescendants(graph, task.id, seen)
    }
  }
  return seen
}
