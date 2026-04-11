import {
  cleanupBranch,
  ensureTaskBranch,
  runPrCheckpoint,
  sleep,
  toTaskBranchName,
} from '../commands/run-branch-helpers'
import { action, sequence } from '../harness/workflow-builders'
import { finalizeTaskCheckbox } from '../workflow/finalize-task-checkbox'
import { createCodexRemoteReviewerProvider } from '../workflow/remote-reviewer'
import { RunArtifactKind, RunPhase, RunResult } from './run-direct'
import { createRunPrTransitions } from './run-pr-transitions'
import {
  createSharedSteps,
  type ContractPayload,
  type ReviewPayload,
  type RuntimePorts,
  type SharedSteps,
} from './shared-steps'

import type { OrchestratorRuntime } from '../core/runtime'
import type { WorkflowProgram } from '../harness/workflow-program'
import type { AgentPort } from '../ports/agent'
import type { CodeHostPort } from '../ports/code-host'

export interface CheckpointPayload {
  checkpointStartedAt: string
  prNumber: number
}

export interface IntegratePrPayload {
  commitSha: string
  prNumber: number
}

export function createRunPrProgram(deps: {
  implementer: AgentPort
  maxIterations: number
  ports: RuntimePorts & { codeHost: CodeHostPort }
  reviewer: AgentPort
  reviewPollIntervalMs?: number
  verifyCommands: string[]
  workspaceRoot: string
}): WorkflowProgram {
  const { maxIterations } = deps
  const reviewPollIntervalMs = deps.reviewPollIntervalMs ?? 60_000
  const steps: SharedSteps = createSharedSteps({
    implementer: deps.implementer,
    ports: deps.ports,
    reviewer: deps.reviewer,
    verifyCommands: deps.verifyCommands,
    workspaceRoot: deps.workspaceRoot,
    artifactKinds: {
      contract: RunArtifactKind.Contract,
      implementation: RunArtifactKind.Implementation,
      integrateResult: RunArtifactKind.IntegrateResult,
      reviewResult: RunArtifactKind.ReviewResult,
      verifyResult: RunArtifactKind.VerifyResult,
    },
  })

  const remoteReviewer = createCodexRemoteReviewerProvider()

  return sequence(
    [
      action(RunPhase.Contract, {
        async run(ctx) {
          const artifact = await steps.contract(ctx.subjectId, {
            attempt: ctx.state.iteration,
            lastFindings: [],
          })
          return {
            artifact,
            result: { kind: RunResult.ContractGenerated },
          }
        },
      }),
      action(RunPhase.Implement, {
        async run(ctx) {
          const contractArtifact = ctx.artifacts.get<ContractPayload>(
            RunArtifactKind.Contract,
          )
          const reviewArtifact = ctx.artifacts.get<ReviewPayload>(
            RunArtifactKind.ReviewResult,
          )
          const lastFindings = reviewArtifact?.payload.findings ?? []
          const artifact = await steps.implement(ctx.subjectId, {
            attempt: ctx.state.iteration,
            lastFindings,
            prompt: contractArtifact!.payload.prompt,
          })
          return {
            artifact,
            result: { kind: RunResult.ImplementationGenerated },
          }
        },
      }),
      action(RunPhase.Verify, {
        async run(ctx) {
          const artifact = await steps.verify(ctx.subjectId)
          const allPassed = artifact.payload.checks.every(
            (c) => c.exitCode === 0,
          )
          return {
            artifact,
            result: {
              kind: allPassed ? RunResult.VerifyPassed : RunResult.VerifyFailed,
            },
          }
        },
      }),
      action(RunPhase.Checkpoint, {
        async run(ctx) {
          const result = await runPrCheckpoint(
            { codeHost: deps.ports.codeHost, git: deps.ports.git },
            deps.ports.taskSource,
            { iteration: ctx.state.iteration, subjectId: ctx.subjectId },
          )
          const payload: CheckpointPayload = {
            checkpointStartedAt: result.checkpointStartedAt,
            prNumber: result.prNumber,
          }
          return {
            result: { kind: RunResult.CheckpointCreated },
            artifact: {
              id: `${RunArtifactKind.CheckpointResult}-${ctx.subjectId}-${Date.now()}`,
              kind: RunArtifactKind.CheckpointResult,
              payload,
              subjectId: ctx.subjectId,
              timestamp: new Date().toISOString(),
            },
          }
        },
      }),
      action(RunPhase.Review, {
        async run(ctx) {
          const checkpointArtifact = ctx.artifacts.get<CheckpointPayload>(
            RunArtifactKind.CheckpointResult,
          )
          const contractArtifact = ctx.artifacts.get<ContractPayload>(
            RunArtifactKind.Contract,
          )
          let reviewResult: Awaited<
            ReturnType<typeof remoteReviewer.evaluatePullRequestReview>
          >
          for (;;) {
            const snapshot = await deps.ports.codeHost.getPullRequestSnapshot({
              pullRequestNumber: checkpointArtifact!.payload.prNumber,
            })
            reviewResult = await remoteReviewer.evaluatePullRequestReview({
              pullRequest: snapshot,
              taskHandle: ctx.subjectId,
              checkpointStartedAt:
                checkpointArtifact!.payload.checkpointStartedAt,
              completionCriteria:
                contractArtifact?.payload.completionCriteria ?? [],
            })
            if (reviewResult.kind !== 'pending') {
              break
            }
            if (reviewPollIntervalMs > 0) {
              await sleep(reviewPollIntervalMs)
            }
          }

          let verdict: string
          let findings: ReviewPayload['findings'] = []
          let summary: string

          if (reviewResult.kind === 'approved') {
            verdict = 'approved'
            summary = reviewResult.review.summary
          } else {
            verdict = 'rejected'
            summary = reviewResult.review.summary
            findings = reviewResult.review.findings.map((f) => ({
              fixHint: f.fixHint,
              issue: f.issue,
              severity: f.severity,
            }))
          }

          const kind =
            verdict === 'approved'
              ? RunResult.ReviewApproved
              : RunResult.ReviewRejected

          const payload: ReviewPayload = {
            findings,
            summary,
            verdict,
          }

          return {
            result: { kind },
            artifact: {
              id: `${RunArtifactKind.ReviewResult}-${ctx.subjectId}-${Date.now()}`,
              kind: RunArtifactKind.ReviewResult,
              payload,
              subjectId: ctx.subjectId,
              timestamp: new Date().toISOString(),
            },
          }
        },
      }),
      action(RunPhase.Integrate, {
        async run(ctx) {
          const commitSubject = deps.ports.taskSource.buildCommitSubject(
            ctx.subjectId,
          )
          const branchName = toTaskBranchName(commitSubject)

          const openPr =
            await deps.ports.codeHost.findOpenPullRequestByHeadBranch({
              headBranch: branchName,
            })

          if (openPr) {
            await ensureTaskBranch(deps.ports.git, branchName, true)
            const taskChecked = await deps.ports.taskSource.isTaskCompleted(
              ctx.subjectId,
            )
            if (!taskChecked) {
              await finalizeTaskCheckbox({
                commitMessage: commitSubject,
                taskHandle: ctx.subjectId,
                runtime: {
                  git: deps.ports.git,
                  github: deps.ports.codeHost,
                  taskSource: deps.ports.taskSource,
                } as OrchestratorRuntime,
              })
            }
            await deps.ports.git.pushBranch(branchName)
            const mergeResult =
              await deps.ports.codeHost.squashMergePullRequest({
                pullRequestNumber: openPr.number,
                subject: commitSubject,
              })

            await cleanupBranch(deps.ports.git, branchName)

            const payload: IntegratePrPayload = {
              commitSha: mergeResult.commitSha,
              prNumber: openPr.number,
            }
            return {
              result: { kind: RunResult.IntegrateCompleted },
              artifact: {
                id: `${RunArtifactKind.IntegrateResult}-${ctx.subjectId}-${Date.now()}`,
                kind: RunArtifactKind.IntegrateResult,
                payload,
                subjectId: ctx.subjectId,
                timestamp: new Date().toISOString(),
              },
            }
          }

          const mergedPr =
            await deps.ports.codeHost.findMergedPullRequestByHeadBranch({
              headBranch: branchName,
            })
          if (!mergedPr) {
            throw new Error(
              `Missing open or merged pull request for branch ${branchName}`,
            )
          }

          await cleanupBranch(deps.ports.git, branchName)

          const payload: IntegratePrPayload = {
            commitSha: mergedPr.mergeCommitSha,
            prNumber: mergedPr.number,
          }
          return {
            result: { kind: RunResult.IntegrateAlreadyIntegrated },
            artifact: {
              id: `${RunArtifactKind.IntegrateResult}-${ctx.subjectId}-${Date.now()}`,
              kind: RunArtifactKind.IntegrateResult,
              payload,
              subjectId: ctx.subjectId,
              timestamp: new Date().toISOString(),
            },
          }
        },
      }),
    ],
    createRunPrTransitions(maxIterations),
  )
}
