import path from 'node:path'

import { execa } from 'execa'
import * as fsExtra from 'fs-extra'

import type { WorkspaceContext } from '../types'

export interface ResolveWorkspaceContextInput {
  cwd: string
  feature?: string | undefined
}

async function resolveWorkspaceRoot(cwd: string) {
  const workspaceRoot = path.resolve(cwd)
  const specsPath = path.join(workspaceRoot, 'specs')
  const specsExists = await fsExtra.pathExists(specsPath)
  if (!specsExists) {
    throw new Error(
      'Current working directory must contain a specs/ directory. Run spec-while from the workspace root.',
    )
  }
  return workspaceRoot
}

async function readFeatureDirs(workspaceRoot: string) {
  const specsDir = path.join(workspaceRoot, 'specs')
  const entries = await fsExtra.readdir(specsDir, {
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

async function detectGitBranch(workspaceRoot: string) {
  try {
    const { stdout } = await execa(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      {
        cwd: workspaceRoot,
      },
    )
    return stdout.trim()
  } catch {
    return null
  }
}

function matchFeatureByPrefix(featureDirs: string[], branch: string) {
  const prefixMatch = branch.match(/^(\d{3}|\d{8}-\d{6})-/)
  const prefix = prefixMatch?.[1]
  if (!prefix) {
    return null
  }
  return featureDirs.find((feature) => feature.startsWith(`${prefix}-`)) ?? null
}

export async function resolveWorkspaceContext(
  input: ResolveWorkspaceContextInput,
): Promise<WorkspaceContext> {
  const workspaceRoot = await resolveWorkspaceRoot(input.cwd)

  const featureDirs = await readFeatureDirs(workspaceRoot)
  let featureId = input.feature ?? null

  if (!featureId) {
    const branch = await detectGitBranch(workspaceRoot)
    if (branch) {
      featureId = matchFeatureByPrefix(featureDirs, branch)
    }
  }

  if (!featureId) {
    if (featureDirs.length === 1) {
      featureId = featureDirs[0] ?? null
    } else {
      throw new Error('Unable to determine feature. Pass --feature explicitly.')
    }
  }

  if (!featureId) {
    throw new Error('Unable to determine feature. Pass --feature explicitly.')
  }

  const featureDir = path.join(workspaceRoot, 'specs', featureId)
  const featureExists = await fsExtra.pathExists(featureDir)
  if (!featureExists) {
    throw new Error(`Feature directory does not exist: ${featureId}`)
  }
  return {
    featureDir,
    featureId,
    runtimeDir: path.join(featureDir, '.while'),
    workspaceRoot,
  }
}
