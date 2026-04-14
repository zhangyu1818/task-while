import { readFile } from 'node:fs/promises'
import path from 'node:path'

import Ajv from 'ajv'
import * as fsExtra from 'fs-extra'
import { z } from 'zod'

import { createFsHarnessStore } from '../adapters/fs/harness-store'
import { loadBatchConfig, type BatchConfig } from '../batch/config'
import { discoverBatchFiles } from '../batch/discovery'
import { runKernel } from '../harness/kernel'
import { createAgentPort } from '../ports/agent'
import { createBatchProgram } from '../programs/batch'
import { createBatchRetryScheduler } from '../schedulers/scheduler'
import { parseWithSchema } from '../schema'
import { runSession, SessionEventType } from '../session/session'
import { writeJsonAtomic } from '../utils/fs'

const batchResultsSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  {
    message: 'results must be an object',
  },
)

export interface RunBatchCommandInput {
  configPath: string
  cwd?: string
  verbose?: boolean
}

export interface RunBatchCommandResult {
  config: BatchConfig
  failedFiles: string[]
  processedFiles: string[]
  results: Record<string, unknown>
  resultsFilePath: string
}

function writeBatchVerboseLine(verbose: boolean | undefined, line: string) {
  if (!verbose) {
    return
  }
  process.stderr.write(`[batch] ${line}\n`)
}

function readSessionProgress(detail: unknown) {
  if (typeof detail !== 'object' || detail === null) {
    return null
  }
  const progress = (detail as { progress?: unknown }).progress
  if (typeof progress !== 'object' || progress === null) {
    return null
  }

  const blocked =
    typeof (progress as { blocked?: unknown }).blocked === 'number'
      ? (progress as { blocked: number }).blocked
      : 0
  const completed =
    typeof (progress as { completed?: unknown }).completed === 'number'
      ? (progress as { completed: number }).completed
      : 0
  const suspended =
    typeof (progress as { suspended?: unknown }).suspended === 'number'
      ? (progress as { suspended: number }).suspended
      : 0

  return { blocked, completed, suspended }
}

async function readJsonFileIfExists(filePath: string) {
  const exists = await fsExtra.pathExists(filePath)
  if (!exists) {
    return null
  }
  const raw = await readFile(filePath, 'utf8')
  const value: unknown = JSON.parse(raw)
  return value
}

async function loadBatchResults(filePath: string) {
  const value = await readJsonFileIfExists(filePath)
  if (value === null) {
    return {}
  }
  return parseWithSchema(batchResultsSchema, value)
}

function createBatchAgent(config: BatchConfig, verbose: boolean | undefined) {
  return createAgentPort(config, {
    ...(verbose === undefined ? {} : { verbose }),
    workspaceRoot: config.configDir,
  })
}

function createOutputValidator(schema: Record<string, unknown>) {
  const ajv = new Ajv({ strict: false })
  const validate = ajv.compile(schema)
  return (value: unknown) => {
    if (validate(value)) {
      return
    }
    throw new Error(ajv.errorsText(validate.errors))
  }
}

export async function runBatchCommand(
  input: RunBatchCommandInput,
): Promise<RunBatchCommandResult> {
  const cwd = input.cwd ?? process.cwd()
  const config = await loadBatchConfig({
    configPath: input.configPath,
    cwd,
  })

  const resultsPath = path.join(config.configDir, 'results.json')
  const excludedFiles = new Set([config.configPath, resultsPath])
  const discoveredFiles = await discoverBatchFiles({
    baseDir: config.configDir,
    excludedFiles,
    patterns: config.glob,
  })
  const results = await loadBatchResults(resultsPath)
  await writeJsonAtomic(resultsPath, results)

  if (discoveredFiles.length === 0) {
    return {
      config,
      failedFiles: [],
      processedFiles: [],
      results,
      resultsFilePath: resultsPath,
    }
  }

  const agent = createBatchAgent(config, input.verbose)
  const validateOutput = createOutputValidator(config.schema)
  const harnessDir = path.join(config.configDir, '.while')
  const store = createFsHarnessStore(harnessDir)
  const protocol = 'batch'

  const program = createBatchProgram({
    agent,
    configDir: config.configDir,
    maxRetries: 3,
    outputSchema: config.schema,
    prompt: config.prompt,
    results,
    resultsPath,
    validateOutput,
  })

  const scheduler = createBatchRetryScheduler({
    files: discoveredFiles,
    protocol,
    results,
    store,
  })

  const processedFiles: string[] = []
  const totalFiles = discoveredFiles.length
  let blockedCount = 0
  let completedCount = 0
  let suspendedCount = 0

  for await (const event of runSession({
    scheduler,
    kernel: {
      run: (subjectId) =>
        runKernel({
          config: { prompt: config.prompt, schema: config.schema },
          program,
          protocol,
          store,
          subjectId,
        }),
    },
  })) {
    if (event.type === SessionEventType.SessionStarted) {
      const progress = readSessionProgress(event.detail)
      if (progress) {
        blockedCount = progress.blocked
        completedCount = progress.completed
        suspendedCount = progress.suspended
      }
      writeBatchVerboseLine(
        input.verbose,
        `resume total=${totalFiles} completed=${completedCount} blocked=${blockedCount} suspended=${suspendedCount}`,
      )
      continue
    }

    if (event.type === SessionEventType.SubjectStarted) {
      writeBatchVerboseLine(
        input.verbose,
        `start completed=${completedCount}/${totalFiles} file=${event.subjectId}`,
      )
      continue
    }

    if (event.type === SessionEventType.SubjectResumed) {
      suspendedCount = Math.max(0, suspendedCount - 1)
      writeBatchVerboseLine(
        input.verbose,
        `resume-file completed=${completedCount}/${totalFiles} file=${event.subjectId}`,
      )
      continue
    }

    if (event.type === SessionEventType.SubjectDone) {
      completedCount += 1
      processedFiles.push(event.subjectId)
      writeBatchVerboseLine(
        input.verbose,
        `done completed=${completedCount}/${totalFiles} file=${event.subjectId}`,
      )
      continue
    }

    if (event.type === SessionEventType.SubjectBlocked) {
      blockedCount += 1
      writeBatchVerboseLine(
        input.verbose,
        `blocked completed=${completedCount}/${totalFiles} file=${event.subjectId}`,
      )
      continue
    }

    if (event.type === SessionEventType.SubjectSuspended) {
      suspendedCount += 1
      writeBatchVerboseLine(
        input.verbose,
        `suspended completed=${completedCount}/${totalFiles} file=${event.subjectId}`,
      )
      continue
    }

    if (event.type === SessionEventType.SessionDone) {
      writeBatchVerboseLine(
        input.verbose,
        `session-done total=${totalFiles} completed=${completedCount} blocked=${blockedCount} suspended=${suspendedCount}`,
      )
    }
  }

  const sets = await scheduler.rebuild()

  return {
    config,
    failedFiles: [...sets.blocked],
    processedFiles,
    results,
    resultsFilePath: resultsPath,
  }
}
