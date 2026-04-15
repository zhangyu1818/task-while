import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

const globEntrySchema = z.string().trim().min(1)

const simplifyConfigSchema = z
  .object({
    prompt: z.string().trim().min(1),
    provider: z.enum(['chatgpt']),
    turns: z.number().int().positive(),
    exclude: z
      .union([globEntrySchema, z.array(globEntrySchema).min(1)])
      .optional(),
  })
  .strict()

export interface SimplifyConfig {
  configDir: string
  configPath: string
  exclude: string[]
  prompt: string
  provider: 'chatgpt'
  turns: number
}

export interface LoadSimplifyConfigInput {
  configPath: string
  cwd: string
}

function normalizeExclude(exclude: string | string[] | undefined): string[] {
  if (!exclude) {
    return []
  }
  return typeof exclude === 'string' ? [exclude] : exclude
}

export async function loadSimplifyConfig(
  input: LoadSimplifyConfigInput,
): Promise<SimplifyConfig> {
  const configPath = path.resolve(input.cwd, input.configPath)
  const configSource = await readFile(configPath, 'utf8')
  const rawConfig = parse(configSource) ?? {}
  const parsed = simplifyConfigSchema.parse(rawConfig)
  const configDir = path.dirname(configPath)

  return {
    configDir,
    configPath,
    exclude: normalizeExclude(parsed.exclude),
    prompt: parsed.prompt,
    provider: parsed.provider,
    turns: parsed.turns,
  }
}
