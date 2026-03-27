import { buildReport } from './engine'

import type {
  ImplementArtifact,
  ReviewArtifact,
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

export interface PersistCommittedArtifactsInput {
  commitSha: string
  implementArtifact: ImplementArtifact
  reviewArtifact: ReviewArtifact
}
