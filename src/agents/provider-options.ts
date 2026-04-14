import { z } from 'zod'

const modelSchema = z.string().trim().min(1)
const timeoutSchema = z.number().int().positive().max(2_147_483_647)

export const codexEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
])

export const claudeEffortSchema = z.enum(['low', 'medium', 'high', 'max'])

export const codexProviderOptionsSchema = z
  .object({
    effort: codexEffortSchema.optional(),
    model: modelSchema.optional(),
    timeout: timeoutSchema.optional(),
  })
  .strict()

export const claudeProviderOptionsSchema = z
  .object({
    effort: claudeEffortSchema.optional(),
    model: modelSchema.optional(),
    timeout: timeoutSchema.optional(),
  })
  .strict()

export type CodexProviderOptions = z.infer<typeof codexProviderOptionsSchema>
export type ClaudeProviderOptions = z.infer<typeof claudeProviderOptionsSchema>

export type WorkflowRoleProviderOptions =
  | (ClaudeProviderOptions & { provider: 'claude' })
  | (CodexProviderOptions & { provider: 'codex' })

export function providerOptionsEqual(
  left: WorkflowRoleProviderOptions,
  right: WorkflowRoleProviderOptions,
) {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.effort === right.effort &&
    left.timeout === right.timeout
  )
}

export function providerOptionsCacheKey(options: {
  effort?: string | undefined
  model?: string | undefined
  provider: 'claude' | 'codex'
  timeout?: number | undefined
}) {
  return [
    options.provider,
    options.model ?? '',
    options.effort ?? '',
    String(options.timeout ?? ''),
  ].join(':')
}
