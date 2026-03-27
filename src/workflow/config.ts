import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

const workflowProviderSchema = z.enum(['claude', 'codex'])
const workflowModeSchema = z.enum(['direct', 'pull-request'])

const workflowRoleSchema = z
  .object({
    provider: workflowProviderSchema.default('codex'),
  })
  .strict()

const workflowRolesSchema = z
  .object({
    implementer: workflowRoleSchema.default({}),
    reviewer: workflowRoleSchema.default({}),
  })
  .strict()

const taskConfigSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(20).default(5),
    source: z.string().trim().min(1).default('spec-kit'),
  })
  .strict()

const workflowConfigSchema = z
  .object({
    task: taskConfigSchema.default({}),
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

export type WorkflowProvider = 'claude' | 'codex'
export type WorkflowMode = 'direct' | 'pull-request'

export interface WorkflowRoleConfig {
  provider: WorkflowProvider
}

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
  source: string
}

export interface WorkflowConfig {
  task: TaskSettingsConfig
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
    workflow: {
      mode: parsedConfig.workflow.mode,
      roles: parsedConfig.workflow.roles,
    },
  }
}
