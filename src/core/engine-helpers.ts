import type {
  PendingTaskState,
  ReviewFinding,
  ReviewOutput,
  ReviewVerdict,
  TaskGraph,
  TaskState,
  TaskTopologyEntry,
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

export function getTask(
  graph: TaskGraph,
  taskHandle: string,
): TaskTopologyEntry {
  const task = graph.tasks.find((item) => item.handle === taskHandle)
  if (!task) {
    throw new Error(`Unknown task: ${taskHandle}`)
  }
  return task
}

export function getTaskState(
  state: WorkflowState,
  taskHandle: string,
): TaskState {
  const taskState = state.tasks[taskHandle]
  if (!taskState) {
    throw new Error(`Missing state for task ${taskHandle}`)
  }
  return taskState
}

export function canStartTask(
  graph: TaskGraph,
  state: WorkflowState,
  taskHandle: string,
) {
  const task = getTask(graph, taskHandle)
  return task.dependsOn.every(
    (dependency) => state.tasks[dependency]?.status === 'done',
  )
}

export function getMaxIterations(graph: TaskGraph) {
  return graph.maxIterations
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
  taskHandle: string,
  seen = new Set<string>(),
) {
  for (const task of graph.tasks) {
    if (task.dependsOn.includes(taskHandle) && !seen.has(task.handle)) {
      seen.add(task.handle)
      collectDescendants(graph, task.handle, seen)
    }
  }
  return seen
}
