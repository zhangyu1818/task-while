import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { TaskStatus, type Artifact } from '../harness/state'
import {
  createWorkflowProgram,
  type WorkflowProgram,
} from '../harness/workflow-program'
import { writeJsonAtomic } from '../utils/fs'

import type { AgentPort } from '../ports/agent'

export enum BatchPhase {
  Persist = 'persist',
  Prepare = 'prepare',
  Process = 'process',
}

export enum BatchResult {
  PersistCompleted = 'persist.completed',
  PrepareCompleted = 'prepare.completed',
  ProcessCompleted = 'process.completed',
  ProcessRetryRequested = 'process.retry_requested',
}

export enum BatchArtifactKind {
  PersistResult = 'persist_result',
  PrepareResult = 'prepare_result',
  ProcessResult = 'process_result',
}

function buildBatchPrompt(input: {
  content: string
  filePath: string
  prompt: string
}) {
  return [
    'Process exactly one file and return structured output only.',
    input.prompt,
    `File path: ${input.filePath}`,
    'File content:',
    input.content,
  ].join('\n\n')
}

export function createBatchProgram(deps: {
  agent: AgentPort
  configDir: string
  maxRetries: number
  outputSchema: Record<string, unknown>
  prompt: string
  results: Record<string, unknown>
  resultsPath: string
  validateOutput: (value: unknown) => void
}): WorkflowProgram {
  return createWorkflowProgram(
    [
      {
        name: BatchPhase.Prepare,
        async run(ctx) {
          const content = await readFile(
            path.join(deps.configDir, ctx.subjectId),
            'utf8',
          )
          const artifact: Artifact<{ content: string; filePath: string }> = {
            id: `${encodeURIComponent(ctx.subjectId)}:${BatchArtifactKind.PrepareResult}`,
            kind: BatchArtifactKind.PrepareResult,
            payload: { content, filePath: ctx.subjectId },
            subjectId: ctx.subjectId,
            timestamp: new Date().toISOString(),
          }
          return {
            artifact,
            result: { kind: BatchResult.PrepareCompleted },
          }
        },
      },
      {
        name: BatchPhase.Process,
        async run(ctx) {
          const prepareArtifact = ctx.artifacts.get<{
            content: string
            filePath: string
          }>(BatchArtifactKind.PrepareResult)
          try {
            const output = await deps.agent.execute({
              outputSchema: deps.outputSchema,
              prompt: buildBatchPrompt({
                content: prepareArtifact!.payload.content,
                filePath: prepareArtifact!.payload.filePath,
                prompt: deps.prompt,
              }),
            })
            deps.validateOutput(output)
            const artifact: Artifact<{ output: unknown }> = {
              id: `${encodeURIComponent(ctx.subjectId)}:${BatchArtifactKind.ProcessResult}`,
              kind: BatchArtifactKind.ProcessResult,
              payload: { output },
              subjectId: ctx.subjectId,
              timestamp: new Date().toISOString(),
            }
            return {
              artifact,
              result: { kind: BatchResult.ProcessCompleted },
            }
          } catch {
            return {
              result: { kind: BatchResult.ProcessRetryRequested },
            }
          }
        },
      },
      {
        name: BatchPhase.Persist,
        async run(ctx) {
          const processArtifact = ctx.artifacts.get<{ output: unknown }>(
            BatchArtifactKind.ProcessResult,
          )
          deps.results[ctx.subjectId] = processArtifact!.payload.output
          await writeJsonAtomic(deps.resultsPath, deps.results)
          const artifact: Artifact<{ filePath: string; persisted: boolean }> = {
            id: `${encodeURIComponent(ctx.subjectId)}:${BatchArtifactKind.PersistResult}`,
            kind: BatchArtifactKind.PersistResult,
            payload: { filePath: ctx.subjectId, persisted: true },
            subjectId: ctx.subjectId,
            timestamp: new Date().toISOString(),
          }
          return {
            artifact,
            result: { kind: BatchResult.PersistCompleted },
          }
        },
      },
    ],
    {
      [BatchPhase.Persist]: {
        [BatchResult.PersistCompleted]: {
          nextPhase: null,
          status: TaskStatus.Done,
        },
      },
      [BatchPhase.Prepare]: {
        [BatchResult.PrepareCompleted]: {
          nextPhase: BatchPhase.Process,
          status: TaskStatus.Running,
        },
      },
      [BatchPhase.Process]: {
        [BatchResult.ProcessCompleted]: {
          nextPhase: BatchPhase.Persist,
          status: TaskStatus.Running,
        },
        [BatchResult.ProcessRetryRequested]: (input) =>
          input.state.iteration >= deps.maxRetries
            ? { nextPhase: null, status: TaskStatus.Blocked }
            : { nextPhase: BatchPhase.Process, status: TaskStatus.Suspended },
      },
    },
  )
}
