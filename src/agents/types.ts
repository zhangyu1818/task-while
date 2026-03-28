import type { PullRequestSnapshot } from '../core/runtime'
import type { TaskPrompt } from '../task-sources/types'
import type { ImplementOutput, ReviewFinding, ReviewOutput } from '../types'

export interface ImplementAgentInput {
  attempt: number
  generation: number
  lastFindings: ReviewFinding[]
  prompt: TaskPrompt
  taskHandle: string
}

export interface ReviewAgentInput {
  actualChangedFiles: string[]
  attempt: number
  generation: number
  implement: ImplementOutput
  lastFindings: ReviewFinding[]
  prompt: TaskPrompt
  taskHandle: string
}

export interface ImplementerProvider {
  implement: (input: ImplementAgentInput) => Promise<ImplementOutput>
  readonly name: string
}

export interface ReviewerProvider {
  readonly name: string
  review: (input: ReviewAgentInput) => Promise<ReviewOutput>
}

export interface PullRequestReviewInput {
  checkpointStartedAt: string
  completionCriteria: string[]
  pullRequest: PullRequestSnapshot
  taskHandle: string
}

export interface PullRequestReviewApprovedResult {
  kind: 'approved'
  review: ReviewOutput
}

export interface PullRequestReviewPendingResult {
  kind: 'pending'
}

export interface PullRequestReviewRejectedResult {
  kind: 'rejected'
  review: ReviewOutput
}

export type PullRequestReviewResult =
  | PullRequestReviewApprovedResult
  | PullRequestReviewPendingResult
  | PullRequestReviewRejectedResult

export interface RemoteReviewerProvider {
  evaluatePullRequestReview: (
    input: PullRequestReviewInput,
  ) => Promise<PullRequestReviewResult>
  readonly name: string
}

export interface WorkflowRoleProviders {
  implementer: ImplementerProvider
  reviewer: RemoteReviewerProvider | ReviewerProvider
}
