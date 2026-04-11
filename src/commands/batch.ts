import { readFile } from 'node:fs/promises'
import path from 'node:path'

import * as fsExtra from 'fs-extra'
import { z } from 'zod'

import { createFsHarnessStore } from '../adapters/fs/harness-store'
import { loadBatchConfig, type BatchConfig } from '../batch/config'
import { discoverBatchFiles } from '../batch/discovery'
import {
  createBatchStructuredOutputProvider,
  type BatchStructuredOutputProvider,
} from '../batch/provider'
import { runKernel } from '../harness/kernel'
import { createBatchProgram } from '../programs/batch'
import { createRuntimePaths } from '../runtime/path-layout'
import { createBatchRetryScheduler } from '../schedulers/scheduler'
import { parseWithSchema } from '../schema/shared'
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

function createProvider(
  config: BatchConfig,
  verbose: boolean | undefined,
): BatchStructuredOutputProvider {
  if (config.provider === 'codex') {
    return createBatchStructuredOutputProvider({
      provider: 'codex',
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(verbose === undefined ? {} : { verbose }),
      workspaceRoot: config.configDir,
    })
  }

  return createBatchStructuredOutputProvider({
    provider: 'claude',
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(verbose === undefined ? {} : { verbose }),
    workspaceRoot: config.configDir,
  })
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

  const provider = createProvider(config, input.verbose)
  const harnessDir = createRuntimePaths(config.configDir).runtimeDir
  const store = createFsHarnessStore(harnessDir)
  const protocol = 'batch'

  const program = createBatchProgram({
    configDir: config.configDir,
    maxRetries: 3,
    outputSchema: config.schema,
    prompt: config.prompt,
    provider,
    results,
    resultsPath,
  })

  const scheduler = createBatchRetryScheduler({
    files: discoveredFiles,
    protocol,
    results,
    store,
  })

  const failedFiles: string[] = []
  const processedFiles: string[] = []

  for await (const event of runSession({
    config: {},
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
    if (event.type === SessionEventType.SubjectDone) {
      processedFiles.push(event.subjectId)
    } else if (event.type === SessionEventType.SubjectBlocked) {
      failedFiles.push(event.subjectId)
    }
  }

  return {
    config,
    failedFiles,
    processedFiles,
    results,
    resultsFilePath: resultsPath,
  }
}
