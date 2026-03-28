import { zodToJsonSchema } from 'zod-to-json-schema'

import {
  finalReportSchema,
  implementArtifactSchema,
  implementOutputSchemaInternal,
  integrateArtifactSchema,
  reviewArtifactSchema,
  reviewOutputSchemaInternal,
  taskGraphSchema,
  workflowEventSchema,
  workflowStateSchema,
  type acceptanceCheckSchema,
  type blockedTaskStateSchema,
  type doneTaskStateSchema,
  type finalReportTaskSchema,
  type pendingTaskStateSchema,
  type replanTaskStateSchema,
  type reviewFindingSchema,
  type reworkTaskStateSchema,
  type runningTaskStateSchema,
  type taskStateSchema,
  type taskTopologyEntrySchema,
} from './model'
import { parseWithSchema } from './shared'

import type { z } from 'zod'

export * from './model'
export * from './shared'

function ensureReviewSemantics(result: ReviewOutput) {
  if (result.verdict === 'pass' && result.findings.length !== 0) {
    throw new Error('Review verdict pass requires empty findings')
  }
  if (
    result.verdict === 'pass' &&
    result.acceptanceChecks.some((check) => check.status !== 'pass')
  ) {
    throw new Error(
      'Review verdict pass requires all acceptance checks to pass',
    )
  }
}

function toOpenAiOutputSchema(
  schema:
    | typeof implementOutputSchemaInternal
    | typeof reviewOutputSchemaInternal,
) {
  return zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'openAi',
  }) as Record<string, unknown>
}

export const implementOutputSchema = toOpenAiOutputSchema(
  implementOutputSchemaInternal,
)
export const reviewOutputSchema = toOpenAiOutputSchema(
  reviewOutputSchemaInternal,
)

export function validateImplementOutput(value: unknown) {
  return parseWithSchema(implementOutputSchemaInternal, value)
}

export function validateReviewOutput(value: unknown) {
  const result = parseWithSchema(reviewOutputSchemaInternal, value)
  ensureReviewSemantics(result)
  return result
}

export function validateTaskGraph(value: unknown) {
  return parseWithSchema(taskGraphSchema, value)
}

export function validateWorkflowState(value: unknown) {
  return parseWithSchema(workflowStateSchema, value)
}

export function validateImplementArtifact(value: unknown) {
  return parseWithSchema(implementArtifactSchema, value)
}

export function validateIntegrateArtifact(value: unknown) {
  return parseWithSchema(integrateArtifactSchema, value)
}

export function validateReviewArtifact(value: unknown) {
  return parseWithSchema(reviewArtifactSchema, value)
}

export function validateWorkflowEvent(value: unknown) {
  return parseWithSchema(workflowEventSchema, value)
}

export function validateFinalReport(value: unknown) {
  return parseWithSchema(finalReportSchema, value)
}

export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>
export type BlockedTaskState = z.infer<typeof blockedTaskStateSchema>
export type DoneTaskState = z.infer<typeof doneTaskStateSchema>
export type FinalReport = z.infer<typeof finalReportSchema>
export type FinalReportTask = z.infer<typeof finalReportTaskSchema>
export type IntegrateArtifact = z.infer<typeof integrateArtifactSchema>
export type ImplementArtifact = z.infer<typeof implementArtifactSchema>
export type ImplementOutput = z.infer<typeof implementOutputSchemaInternal>
export type PendingTaskState = z.infer<typeof pendingTaskStateSchema>
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>
export type ReviewFinding = z.infer<typeof reviewFindingSchema>
export type ReviewOutput = z.infer<typeof reviewOutputSchemaInternal>
export type ReviewVerdict = z.infer<
  typeof reviewOutputSchemaInternal
>['verdict']
export type ReplanTaskState = z.infer<typeof replanTaskStateSchema>
export type ReworkTaskState = z.infer<typeof reworkTaskStateSchema>
export type RunningStage = z.infer<typeof runningTaskStateSchema>['stage']
export type RunningTaskState = z.infer<typeof runningTaskStateSchema>
export type TaskTopologyEntry = z.infer<typeof taskTopologyEntrySchema>
export type TaskGraph = z.infer<typeof taskGraphSchema>
export type TaskState = z.infer<typeof taskStateSchema>
export type TaskStatus = z.infer<typeof taskStateSchema>['status']
export type WorkflowEvent = z.infer<typeof workflowEventSchema>
export type WorkflowEventType = z.infer<typeof workflowEventSchema>['type']
export type WorkflowState = z.infer<typeof workflowStateSchema>
