import { execa } from 'execa'

import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema'

import type { GitPort } from '../core/runtime'
import type { Artifact } from '../harness/state'
import type { AgentPort } from '../ports/agent'
import type { TaskSourceSession } from '../task-sources/types'
import type { ImplementOutput, ReviewFinding } from '../types'

export type ImplementPayload = ImplementOutput

export interface IntegratePayload {
  commitSha: string
}

export interface ReviewPayload {
  findings: ReviewFinding[]
  summary: string
  verdict: string
}

export interface VerifyPayload {
  checks: {
    command: string
    durationMs: number
    exitCode: number
    signal: null | string
  }[]
}

export interface RuntimePorts {
  git: GitPort
  taskSource: TaskSourceSession
}

export interface SharedSteps {
  implement: (
    subjectId: string,
    input: {
      attempt: number
      lastFindings: ReviewFinding[]
    },
  ) => Promise<Artifact<ImplementPayload>>
  integrate: (subjectId: string) => Promise<Artifact<IntegratePayload>>
  review: (
    subjectId: string,
    input: {
      attempt: number
      implement: ImplementPayload
      lastFindings: ReviewFinding[]
    },
  ) => Promise<Artifact<ReviewPayload>>
  verify: (subjectId: string) => Promise<Artifact<VerifyPayload>>
}

export function makeArtifact<T>(
  kind: string,
  subjectId: string,
  payload: T,
): Artifact<T> {
  return {
    id: `${kind}-${subjectId}-${Date.now()}`,
    kind,
    payload,
    subjectId,
    timestamp: new Date().toISOString(),
  }
}

export function createSharedSteps(deps: {
  artifactKinds: {
    implementation: string
    integrateResult: string
    reviewResult: string
    verifyResult: string
  }
  implementer: AgentPort
  ports: RuntimePorts
  reviewer?: AgentPort
  verifyCommands: string[]
  workspaceRoot: string
}): SharedSteps {
  const {
    artifactKinds,
    implementer,
    ports,
    reviewer,
    verifyCommands,
    workspaceRoot,
  } = deps

  return {
    async implement(subjectId, input) {
      const prompt = await ports.taskSource.buildImplementPrompt(subjectId)
      const promptText = await buildImplementerPrompt({
        attempt: input.attempt,
        lastFindings: input.lastFindings,
        prompt,
        taskHandle: subjectId,
      })
      const raw = await implementer.execute({
        outputSchema: implementOutputSchema,
        prompt: promptText,
      })
      const validated = validateImplementOutput(raw)
      return makeArtifact(artifactKinds.implementation, subjectId, validated)
    },

    async integrate(subjectId) {
      const message = ports.taskSource.buildCommitSubject(subjectId)
      const alreadyDone = await ports.taskSource.isTaskCompleted(subjectId)
      if (!alreadyDone) {
        await ports.taskSource.applyTaskCompletion(subjectId)
      }
      try {
        const result = await ports.git.commitTask({ message })
        return makeArtifact(artifactKinds.integrateResult, subjectId, {
          commitSha: result.commitSha,
        })
      } catch (error) {
        if (!alreadyDone) {
          try {
            await ports.taskSource.revertTaskCompletion(subjectId)
          } catch {
            // revert best-effort
          }
        }
        throw error
      }
    },

    async review(subjectId, input) {
      const changedFiles = await ports.git.getChangedFilesSinceHead()
      const implementOutput: ImplementOutput = {
        assumptions: input.implement.assumptions,
        needsHumanAttention: input.implement.needsHumanAttention,
        notes: input.implement.notes,
        status: input.implement.status,
        summary: input.implement.summary,
        taskHandle: subjectId,
        unresolvedItems: input.implement.unresolvedItems,
      }
      const prompt = await ports.taskSource.buildReviewPrompt(subjectId)
      const promptText = await buildReviewerPrompt({
        actualChangedFiles: changedFiles,
        attempt: input.attempt,
        implement: implementOutput,
        lastFindings: input.lastFindings,
        prompt,
        taskHandle: subjectId,
      })
      if (!reviewer) {
        throw new Error('review step requires a reviewer agent')
      }
      const raw = await reviewer.execute({
        outputSchema: reviewOutputSchema,
        prompt: promptText,
      })
      const validated = validateReviewOutput(raw)
      const verdict =
        validated.verdict === 'pass'
          ? 'approved'
          : validated.verdict === 'blocked'
            ? 'replan_required'
            : 'rejected'
      const payload: ReviewPayload = {
        findings: validated.findings,
        summary: validated.summary,
        verdict,
      }
      return makeArtifact(artifactKinds.reviewResult, subjectId, payload)
    },

    async verify(subjectId) {
      const checks: VerifyPayload['checks'] = []
      for (const command of verifyCommands) {
        const start = Date.now()
        try {
          const result = await execa(command, {
            cwd: workspaceRoot,
            reject: false,
            shell: true,
          })
          checks.push({
            command,
            durationMs: Date.now() - start,
            exitCode: result.exitCode,
            signal: result.signal ?? null,
          })
        } catch {
          checks.push({
            command,
            durationMs: Date.now() - start,
            exitCode: 1,
            signal: null,
          })
        }
      }
      return makeArtifact(artifactKinds.verifyResult, subjectId, { checks })
    },
  }
}
