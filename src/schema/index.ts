import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

const nonEmptyStringSchema = z.string().min(1)
const taskHandleSchema = nonEmptyStringSchema

const implementStatusValues = ['blocked', 'implemented', 'partial'] as const
const findingSeverityValues = ['high', 'low', 'medium'] as const
const acceptanceStatusValues = ['fail', 'pass', 'unclear'] as const
const overallRiskValues = ['high', 'low', 'medium'] as const
const reviewVerdictValues = ['blocked', 'pass', 'replan', 'rework'] as const

function uniqueStrings(items: string[], label: string, ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (seen.has(item)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${label}: ${item}`,
        path: [index],
      })
      continue
    }
    seen.add(item)
  }
}

function uniqueStringArray(label: string, options?: { minItems?: number }) {
  const base = z.array(nonEmptyStringSchema)
  const withMin = options?.minItems ? base.min(options.minItems) : base
  return withMin.superRefine((items, ctx) => {
    uniqueStrings(items, label, ctx)
  })
}

function formatPath(path: (number | string)[]) {
  if (path.length === 0) {
    return '/'
  }
  return `/${path.join('/')}`
}

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${formatPath(issue.path)} ${issue.message}`.trim())
    .join('; ')
}

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(formatIssues(result.error))
  }
  return result.data
}

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

export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>
export type ImplementOutput = z.infer<typeof implementOutputSchemaInternal>
export type ReviewFinding = z.infer<typeof reviewFindingSchema>
export type ReviewOutput = z.infer<typeof reviewOutputSchemaInternal>

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
