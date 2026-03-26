import { appendFile, readFile, writeFile } from 'node:fs/promises'
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

import type {
  AttemptArtifactKey,
  OrchestratorRuntime,
  WorkspaceTaskCheckUpdate,
} from '../core/runtime'
import type { TaskDefinition } from '../types'

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

function buildTasksSnippet(tasksMd: string, taskId: string) {
  const lines = tasksMd.split(/\r?\n/)
  const taskHeaderPattern = new RegExp(String.raw`^- \[[ Xx]\] ${taskId}(?=\b)`)
  const taskIndex = lines.findIndex((line) => taskHeaderPattern.test(line))
  return taskIndex >= 0
    ? lines.slice(taskIndex, taskIndex + 10).join('\n')
    : tasksMd
}

function isTaskChecked(tasksMd: string, taskId: string) {
  const pattern = new RegExp(String.raw`^- \[X\] ${taskId}(?=\b)`, 'm')
  return pattern.test(tasksMd)
}

async function readTextFileIfExists(filePath: string) {
  const exists = await fsExtra.pathExists(filePath)
  if (!exists) {
    return null
  }
  return readFile(filePath, 'utf8')
}

async function readRequiredTextFile(filePath: string) {
  const raw = await readTextFileIfExists(filePath)
  if (raw === null) {
    throw new Error(`Missing required feature file: ${filePath}`)
  }
  return raw
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

async function updateTaskCheckboxes(
  tasksPath: string,
  updates: WorkspaceTaskCheckUpdate[],
) {
  const content = await readFile(tasksPath, 'utf8')
  const updated = updates.reduce((current, update) => {
    const pattern = new RegExp(
      String.raw`^- \[[ Xx]\] ${update.taskId}(?=\b)`,
      'm',
    )
    const replacement = update.checked
      ? `- [X] ${update.taskId}`
      : `- [ ] ${update.taskId}`
    return current.replace(pattern, replacement)
  }, content)
  await writeFile(tasksPath, updated)
}

export interface CreateOrchestratorRuntimeInput {
  featureDir: string
  workspaceRoot: string
}

export function createOrchestratorRuntime(
  input: CreateOrchestratorRuntimeInput,
): OrchestratorRuntime {
  const tasksPath = path.join(input.featureDir, 'tasks.md')
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
            key.taskId,
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
            key.taskId,
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
            artifact.taskId,
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
            artifact.taskId,
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
            artifact.taskId,
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
    workspace: {
      async isTaskChecked(taskId) {
        const tasksMd = await readTextFileIfExists(tasksPath)
        return isTaskChecked(tasksMd ?? '', taskId)
      },
      async loadTaskContext(task: TaskDefinition) {
        const specPath = path.join(input.featureDir, 'spec.md')
        const planPath = path.join(input.featureDir, 'plan.md')
        const [spec, plan, tasksMd] = await Promise.all([
          readRequiredTextFile(specPath),
          readRequiredTextFile(planPath),
          readRequiredTextFile(tasksPath),
        ])
        return {
          plan,
          spec,
          tasksSnippet: buildTasksSnippet(tasksMd, task.id),
        }
      },
      async updateTaskChecks(updates) {
        await updateTaskCheckboxes(tasksPath, updates)
      },
    },
  }
}
