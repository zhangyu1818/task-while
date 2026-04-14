import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

import {
  claudeProviderOptionsSchema,
  codexProviderOptionsSchema,
  type WorkflowRoleProviderOptions,
} from '../agents/provider-options'

import type { TaskSourceName } from '../task-sources/types'

const workflowModeSchema = z.enum(['direct', 'pull-request'])

const defaultWorkflowRole: WorkflowRoleProviderOptions = {
  provider: 'codex',
}

const workflowRoleProviderSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('claude'),
    })
    .extend(claudeProviderOptionsSchema.shape)
    .strict(),
  z
    .object({
      provider: z.literal('codex'),
    })
    .extend(codexProviderOptionsSchema.shape)
    .strict(),
])

const workflowRoleSchema = z.preprocess((value) => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const role = value as Record<string, unknown>
    if (!('provider' in role)) {
      return {
        ...role,
        provider: 'codex',
      }
    }
  }
  return value
}, workflowRoleProviderSchema)

const workflowRolesSchema = z
  .object({
    implementer: workflowRoleSchema.default(defaultWorkflowRole),
    reviewer: workflowRoleSchema.default(defaultWorkflowRole),
  })
  .strict()

const taskConfigSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(20).default(5),
    source: z.enum(['spec-kit', 'openspec']).default('spec-kit'),
  })
  .strict()

const verifyConfigSchema = z
  .object({
    commands: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()

const workflowConfigSchema = z
  .object({
    task: taskConfigSchema.default({}),
    verify: verifyConfigSchema.default({}),
    workflow: z
      .object({
        mode: workflowModeSchema.default('direct'),
        roles: workflowRolesSchema.default({}),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({})

export type WorkflowMode = 'direct' | 'pull-request'

export type WorkflowProvider = WorkflowRoleProviderOptions['provider']
export type WorkflowRoleConfig = WorkflowRoleProviderOptions

export interface WorkflowRolesConfig {
  implementer: WorkflowRoleConfig
  reviewer: WorkflowRoleConfig
}

export interface WorkflowSettingsConfig {
  mode: WorkflowMode
  roles: WorkflowRolesConfig
}

export interface TaskSettingsConfig {
  maxIterations: number
  source: TaskSourceName
}

export interface VerifyConfig {
  commands: string[]
}

export interface WorkflowConfig {
  task: TaskSettingsConfig
  verify: VerifyConfig
  workflow: WorkflowSettingsConfig
}

export async function loadWorkflowConfig(
  workspaceRoot: string,
): Promise<WorkflowConfig> {
  const configPath = path.join(workspaceRoot, 'while.yaml')
  let rawConfig: unknown = {}

  try {
    const configSource = await readFile(configPath, 'utf8')
    rawConfig = parse(configSource) ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const parsedConfig = workflowConfigSchema.parse(rawConfig)

  return {
    task: {
      maxIterations: parsedConfig.task.maxIterations,
      source: parsedConfig.task.source,
    },
    verify: {
      commands: parsedConfig.verify.commands,
    },
    workflow: {
      mode: parsedConfig.workflow.mode,
      roles: parsedConfig.workflow.roles,
    },
  }
}
