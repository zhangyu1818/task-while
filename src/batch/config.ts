import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

import {
  claudeProviderOptionsSchema,
  codexProviderOptionsSchema,
  type WorkflowRoleProviderOptions,
} from '../agents/provider-options'

export const batchProviderSchema = z.enum(['claude', 'codex'])

const jsonSchemaSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  {
    message: 'schema must be an object',
  },
)

const globEntrySchema = z.string().trim().min(1)

const globSchema = z
  .union([globEntrySchema, z.array(globEntrySchema).min(1)])
  .optional()

const commonBatchConfigSchema = z
  .object({
    glob: globSchema,
    prompt: z.string().trim().min(1),
    schema: jsonSchemaSchema,
  })
  .strict()

const batchConfigSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('claude'),
    })
    .extend(claudeProviderOptionsSchema.shape)
    .extend(commonBatchConfigSchema.shape)
    .strict(),
  z
    .object({
      provider: z.literal('codex'),
    })
    .extend(codexProviderOptionsSchema.shape)
    .extend(commonBatchConfigSchema.shape)
    .strict(),
])

export type BatchProviderName = WorkflowRoleProviderOptions['provider']

interface BatchConfigBase {
  configDir: string
  configPath: string
  glob: string[]
  prompt: string
  schema: Record<string, unknown>
}

export type BatchConfig = BatchConfigBase & WorkflowRoleProviderOptions

export interface LoadBatchConfigInput {
  configPath: string
  cwd: string
}

function normalizeGlobConfig(glob: string | string[] | undefined) {
  if (!glob) {
    return ['**/*']
  }
  return typeof glob === 'string' ? [glob] : glob
}

export async function loadBatchConfig(
  input: LoadBatchConfigInput,
): Promise<BatchConfig> {
  const configPath = path.resolve(input.cwd, input.configPath)
  const configSource = await readFile(configPath, 'utf8')
  const rawConfig = parse(configSource) ?? {}
  const parsedConfig = batchConfigSchema.parse(rawConfig)
  const configDir = path.dirname(configPath)
  const baseConfig = {
    configDir,
    configPath,
    glob: normalizeGlobConfig(parsedConfig.glob),
    prompt: parsedConfig.prompt,
    schema: parsedConfig.schema,
  }

  if (parsedConfig.provider === 'claude') {
    return {
      ...baseConfig,
      provider: 'claude',
      ...(parsedConfig.model ? { model: parsedConfig.model } : {}),
      ...(parsedConfig.effort ? { effort: parsedConfig.effort } : {}),
      ...(parsedConfig.timeout ? { timeout: parsedConfig.timeout } : {}),
    }
  }

  return {
    ...baseConfig,
    provider: 'codex',
    ...(parsedConfig.model ? { model: parsedConfig.model } : {}),
    ...(parsedConfig.effort ? { effort: parsedConfig.effort } : {}),
    ...(parsedConfig.timeout ? { timeout: parsedConfig.timeout } : {}),
  }
}
