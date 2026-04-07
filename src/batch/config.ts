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

const commonBatchConfigSchema = z
  .object({
    prompt: z.string().trim().min(1),
    schema: jsonSchemaSchema,
    workdir: z.string().trim().min(1).optional(),
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
  configPath: string
  outputDir: string
  prompt: string
  schema: Record<string, unknown>
  workdir: string
}

export type BatchConfig = BatchConfigBase & WorkflowRoleProviderOptions

export interface LoadBatchConfigInput {
  configPath: string
  cwd: string
}

export async function loadBatchConfig(
  input: LoadBatchConfigInput,
): Promise<BatchConfig> {
  const configPath = path.resolve(input.cwd, input.configPath)
  const configSource = await readFile(configPath, 'utf8')
  const rawConfig = parse(configSource) ?? {}
  const parsedConfig = batchConfigSchema.parse(rawConfig)
  const outputDir = path.dirname(configPath)
  const workdir = parsedConfig.workdir
    ? path.resolve(outputDir, parsedConfig.workdir)
    : path.resolve(input.cwd)
  const baseConfig = {
    configPath,
    outputDir,
    prompt: parsedConfig.prompt,
    schema: parsedConfig.schema,
    workdir,
  }

  if (parsedConfig.provider === 'claude') {
    return {
      ...baseConfig,
      provider: 'claude',
      ...(parsedConfig.model ? { model: parsedConfig.model } : {}),
      ...(parsedConfig.effort ? { effort: parsedConfig.effort } : {}),
    }
  }

  return {
    ...baseConfig,
    provider: 'codex',
    ...(parsedConfig.model ? { model: parsedConfig.model } : {}),
    ...(parsedConfig.effort ? { effort: parsedConfig.effort } : {}),
  }
}
