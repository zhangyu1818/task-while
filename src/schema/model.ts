import { z } from 'zod'

import {
  acceptanceStatusValues,
  dateTimeSchema,
  finalStatusValues,
  findingSeverityValues,
  implementStatusValues,
  nonEmptyStringSchema,
  overallRiskValues,
  reviewVerdictValues,
  runningStageValues,
  taskHandleSchema,
  taskStatusValues,
  uniqueStringArray,
  workflowEventTypeValues,
} from './shared'

export const reviewFindingSchema = z
  .object({
    file: nonEmptyStringSchema.optional(),
    fixHint: nonEmptyStringSchema,
    issue: nonEmptyStringSchema,
    severity: z.enum(findingSeverityValues),
  })
  .strict()

export const acceptanceCheckSchema = z
  .object({
    criterion: nonEmptyStringSchema,
    note: nonEmptyStringSchema,
    status: z.enum(acceptanceStatusValues),
  })
  .strict()

export const taskTopologyEntrySchema = z
  .object({
    commitSubject: nonEmptyStringSchema,
    dependsOn: uniqueStringArray('dependency task handle'),
    handle: taskHandleSchema,
  })
  .strict()

export const taskGraphSchema = z
  .object({
    featureId: nonEmptyStringSchema,
    maxIterations: z.number().int().min(1).max(20),
    tasks: z
      .array(taskTopologyEntrySchema)
      .min(1)
      .superRefine((tasks, ctx) => {
        const seen = new Set<string>()
        for (const [index, task] of tasks.entries()) {
          if (seen.has(task.handle)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate task handle: ${task.handle}`,
              path: [index, 'handle'],
            })
            continue
          }
          seen.add(task.handle)
        }
      }),
  })
  .strict()

export const implementOutputSchemaInternal = z
  .object({
    assumptions: uniqueStringArray('assumption'),
    needsHumanAttention: z.boolean(),
    notes: uniqueStringArray('note'),
    status: z.enum(implementStatusValues),
    summary: nonEmptyStringSchema,
    taskHandle: taskHandleSchema,
    unresolvedItems: uniqueStringArray('unresolved item'),
  })
  .strict()

export const reviewOutputSchemaInternal = z
  .object({
    acceptanceChecks: z.array(acceptanceCheckSchema).min(1),
    findings: z.array(reviewFindingSchema),
    overallRisk: z.enum(overallRiskValues),
    summary: nonEmptyStringSchema,
    taskHandle: taskHandleSchema,
    verdict: z.enum(reviewVerdictValues),
  })
  .strict()

const taskStateBaseSchema = z
  .object({
    attempt: z.number().int().min(0),
    generation: z.number().int().min(1),
    invalidatedBy: taskHandleSchema.nullable(),
    lastFindings: z.array(reviewFindingSchema),
    lastReviewVerdict: z.enum(reviewVerdictValues).optional(),
  })
  .strict()

export const pendingTaskStateSchema = taskStateBaseSchema
  .extend({
    status: z.literal('pending'),
  })
  .strict()

export const runningTaskStateSchema = taskStateBaseSchema
  .extend({
    stage: z.enum(runningStageValues),
    status: z.literal('running'),
  })
  .strict()

export const reworkTaskStateSchema = taskStateBaseSchema
  .extend({
    status: z.literal('rework'),
  })
  .strict()

export const doneTaskStateSchema = taskStateBaseSchema
  .extend({
    commitSha: nonEmptyStringSchema,
    status: z.literal('done'),
  })
  .strict()

export const blockedTaskStateSchema = taskStateBaseSchema
  .extend({
    reason: nonEmptyStringSchema,
    status: z.literal('blocked'),
  })
  .strict()

export const replanTaskStateSchema = taskStateBaseSchema
  .extend({
    reason: nonEmptyStringSchema,
    status: z.literal('replan'),
  })
  .strict()

export const taskStateSchema = z.discriminatedUnion('status', [
  pendingTaskStateSchema,
  runningTaskStateSchema,
  reworkTaskStateSchema,
  doneTaskStateSchema,
  blockedTaskStateSchema,
  replanTaskStateSchema,
])

export const workflowStateSchema = z
  .object({
    currentTaskHandle: taskHandleSchema.nullable(),
    featureId: nonEmptyStringSchema,
    tasks: z.record(taskStateSchema),
  })
  .strict()

export const implementArtifactSchema = z
  .object({
    attempt: z.number().int().min(1),
    commitSha: nonEmptyStringSchema.optional(),
    createdAt: dateTimeSchema,
    generation: z.number().int().min(1),
    result: implementOutputSchemaInternal,
    taskHandle: taskHandleSchema,
  })
  .strict()

export const reviewArtifactSchema = z
  .object({
    attempt: z.number().int().min(1),
    commitSha: nonEmptyStringSchema.optional(),
    createdAt: dateTimeSchema,
    generation: z.number().int().min(1),
    result: reviewOutputSchemaInternal,
    taskHandle: taskHandleSchema,
  })
  .strict()

export const integrateArtifactSchema = z
  .object({
    attempt: z.number().int().min(1),
    createdAt: dateTimeSchema,
    generation: z.number().int().min(1),
    taskHandle: taskHandleSchema,
    result: z
      .object({
        commitSha: nonEmptyStringSchema,
        summary: nonEmptyStringSchema,
      })
      .strict(),
  })
  .strict()

export const workflowEventSchema = z
  .object({
    attempt: z.number().int().min(0),
    detail: z.string().optional(),
    generation: z.number().int().min(1),
    taskHandle: taskHandleSchema,
    timestamp: dateTimeSchema,
    type: z.enum(workflowEventTypeValues),
  })
  .strict()

export const finalReportTaskSchema = z
  .object({
    attempt: z.number().int().min(0),
    commitSha: nonEmptyStringSchema.optional(),
    generation: z.number().int().min(1),
    lastReviewVerdict: z.enum(reviewVerdictValues).optional(),
    reason: nonEmptyStringSchema.optional(),
    status: z.enum(taskStatusValues),
    taskHandle: taskHandleSchema,
  })
  .strict()

export const finalReportSchema = z
  .object({
    featureId: nonEmptyStringSchema,
    generatedAt: dateTimeSchema,
    tasks: z.array(finalReportTaskSchema),
    summary: z
      .object({
        blockedTasks: z.number().int().min(0),
        completedTasks: z.number().int().min(0),
        finalStatus: z.enum(finalStatusValues),
        replanTasks: z.number().int().min(0),
        totalTasks: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()
