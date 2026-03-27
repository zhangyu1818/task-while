import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

import * as fsExtra from 'fs-extra'

import {
  validateFinalReport,
  validateImplementArtifact,
  validateIntegrateArtifact,
  validateReviewArtifact,
  validateTaskGraph,
  validateWorkflowEvent,
  validateWorkflowState,
} from '../schema/index'
import { writeJsonAtomic } from '../utils/fs'
import { GitRuntime } from './git'
import { GitHubRuntime } from './github'
import { createRuntimePaths } from './path-layout'

import type { AttemptArtifactKey, OrchestratorRuntime } from '../core/runtime'
import type { TaskSourceSession } from '../task-sources/types'

function createArtifactDir(
  featureDir: string,
  taskId: string,
  generation: number,
  attempt: number,
) {
  const runtimePaths = createRuntimePaths(featureDir)
  return path.join(
    runtimePaths.tasksDir,
    taskId,
    `g${generation}`,
    `a${attempt}`,
  )
}

async function readTextFileIfExists(filePath: string) {
  const exists = await fsExtra.pathExists(filePath)
  if (!exists) {
    return null
  }
  return readFile(filePath, 'utf8')
}

async function readValidatedJsonFileIfExists<T>(
  filePath: string,
  validate: (value: unknown) => T,
): Promise<null | T> {
  const raw = await readTextFileIfExists(filePath)
  if (raw === null) {
    return null
  }
  return validate(JSON.parse(raw))
}

export interface CreateOrchestratorRuntimeInput {
  featureDir: string
  taskSource?: TaskSourceSession
  workspaceRoot: string
}

export function createOrchestratorRuntime(
  input: CreateOrchestratorRuntimeInput,
): OrchestratorRuntime {
  const runtimePaths = createRuntimePaths(input.featureDir)

  return {
    git: new GitRuntime(input.workspaceRoot, runtimePaths.runtimeDir),
    github: new GitHubRuntime(input.workspaceRoot),
    store: {
      async appendEvent(event) {
        const value = validateWorkflowEvent(event)
        await fsExtra.ensureDir(path.dirname(runtimePaths.events))
        await appendFile(runtimePaths.events, `${JSON.stringify(value)}\n`)
      },
      async loadGraph() {
        return readValidatedJsonFileIfExists(
          runtimePaths.graph,
          validateTaskGraph,
        )
      },
      async loadImplementArtifact(key: AttemptArtifactKey) {
        const filePath = path.join(
          createArtifactDir(
            input.featureDir,
            key.taskHandle,
            key.generation,
            key.attempt,
          ),
          'implement.json',
        )
        return readValidatedJsonFileIfExists(
          filePath,
          validateImplementArtifact,
        )
      },
      async loadReviewArtifact(key: AttemptArtifactKey) {
        const filePath = path.join(
          createArtifactDir(
            input.featureDir,
            key.taskHandle,
            key.generation,
            key.attempt,
          ),
          'review.json',
        )
        return readValidatedJsonFileIfExists(filePath, validateReviewArtifact)
      },
      async loadState() {
        return readValidatedJsonFileIfExists(
          runtimePaths.state,
          validateWorkflowState,
        )
      },
      async readReport() {
        return readValidatedJsonFileIfExists(
          runtimePaths.report,
          validateFinalReport,
        )
      },
      async reset() {
        await fsExtra.remove(runtimePaths.runtimeDir)
      },
      async saveGraph(graph) {
        await writeJsonAtomic(runtimePaths.graph, validateTaskGraph(graph))
      },
      async saveImplementArtifact(artifact) {
        const value = validateImplementArtifact(artifact)
        const targetPath = path.join(
          createArtifactDir(
            input.featureDir,
            artifact.taskHandle,
            artifact.generation,
            artifact.attempt,
          ),
          'implement.json',
        )
        await writeJsonAtomic(targetPath, value)
      },
      async saveIntegrateArtifact(artifact) {
        const value = validateIntegrateArtifact(artifact)
        const targetPath = path.join(
          createArtifactDir(
            input.featureDir,
            artifact.taskHandle,
            artifact.generation,
            artifact.attempt,
          ),
          'integrate.json',
        )
        await writeJsonAtomic(targetPath, value)
      },
      async saveReport(report) {
        await writeJsonAtomic(runtimePaths.report, validateFinalReport(report))
      },
      async saveReviewArtifact(artifact) {
        const value = validateReviewArtifact(artifact)
        const targetPath = path.join(
          createArtifactDir(
            input.featureDir,
            artifact.taskHandle,
            artifact.generation,
            artifact.attempt,
          ),
          'review.json',
        )
        await writeJsonAtomic(targetPath, value)
      },
      async saveState(state) {
        await writeJsonAtomic(runtimePaths.state, validateWorkflowState(state))
      },
    },
    taskSource:
      input.taskSource ??
      ({
        async applyTaskCompletion() {
          throw new Error('task source is not configured')
        },
        buildCommitSubject() {
          throw new Error('task source is not configured')
        },
        async buildImplementPrompt() {
          throw new Error('task source is not configured')
        },
        async buildReviewPrompt() {
          throw new Error('task source is not configured')
        },
        async getCompletionCriteria() {
          throw new Error('task source is not configured')
        },
        getTaskDependencies() {
          throw new Error('task source is not configured')
        },
        async isTaskCompleted() {
          throw new Error('task source is not configured')
        },
        listTasks() {
          throw new Error('task source is not configured')
        },
        resolveTaskSelector() {
          throw new Error('task source is not configured')
        },
        async revertTaskCompletion() {
          throw new Error('task source is not configured')
        },
      } satisfies TaskSourceSession),
  }
}
