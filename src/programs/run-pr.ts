import {
  cleanupBranch,
  ensureTaskBranch,
  runPrCheckpoint,
  sleep,
  toTaskBranchName,
} from '../commands/run-branch-helpers'
import {
  errorRetry,
  KernelResultKind,
  retryBudgetReached,
} from '../harness/kernel'
import { TaskStatus } from '../harness/state'
import {
  createWorkflowProgram,
  type Transition,
  type TransitionRule,
  type WorkflowProgram,
} from '../harness/workflow-program'
import { finalizeTaskCheckbox } from '../workflow/finalize-task-checkbox'
import { createCodexRemoteReviewerProvider } from '../workflow/remote-reviewer'
import { RunArtifactKind, RunPhase, RunResult } from './run-direct'
import {
  createSharedSteps,
  makeArtifact,
  type ReviewPayload,
  type RuntimePorts,
} from './shared-steps'

import type { GitHubPort, OrchestratorRuntime } from '../core/runtime'
import type { AgentPort } from '../ports/agent'

export interface CheckpointPayload {
  checkpointStartedAt: string
  prNumber: number
}

export interface IntegratePrPayload {
  commitSha: string
  prNumber: number
}

const remoteReviewer = createCodexRemoteReviewerProvider()

async function createCheckpointResult(input: {
  iteration: number
  ports: RuntimePorts & { github: GitHubPort }
  subjectId: string
}) {
  const result = await runPrCheckpoint(
    { git: input.ports.git, github: input.ports.github },
    input.ports.taskSource,
    { iteration: input.iteration, subjectId: input.subjectId },
  )
  return {
    result: { kind: RunResult.CheckpointCreated as const },
    artifact: makeArtifact(RunArtifactKind.CheckpointResult, input.subjectId, {
      checkpointStartedAt: result.checkpointStartedAt,
      prNumber: result.prNumber,
    } satisfies CheckpointPayload),
  }
}

async function createReviewResult(input: {
  checkpoint: CheckpointPayload
  completionCriteria: string[]
  github: GitHubPort
  reviewPollIntervalMs: number
  subjectId: string
}) {
  let reviewResult: Awaited<
    ReturnType<typeof remoteReviewer.evaluatePullRequestReview>
  >
  for (;;) {
    const snapshot = await input.github.getPullRequestSnapshot({
      pullRequestNumber: input.checkpoint.prNumber,
    })
    reviewResult = await remoteReviewer.evaluatePullRequestReview({
      checkpointStartedAt: input.checkpoint.checkpointStartedAt,
      completionCriteria: input.completionCriteria,
      pullRequest: snapshot,
      taskHandle: input.subjectId,
    })
    if (reviewResult.kind !== 'pending') {
      break
    }
    if (input.reviewPollIntervalMs > 0) {
      await sleep(input.reviewPollIntervalMs)
    }
  }

  const payload: ReviewPayload =
    reviewResult.kind === 'approved'
      ? {
          findings: [],
          summary: reviewResult.review.summary,
          verdict: 'approved',
        }
      : {
          summary: reviewResult.review.summary,
          verdict: 'rejected',
          findings: reviewResult.review.findings.map((finding) => ({
            fixHint: finding.fixHint,
            issue: finding.issue,
            severity: finding.severity,
          })),
        }

  return {
    artifact: makeArtifact(
      RunArtifactKind.ReviewResult,
      input.subjectId,
      payload,
    ),
    result: {
      kind:
        payload.verdict === 'approved'
          ? RunResult.ReviewApproved
          : RunResult.ReviewRejected,
    },
  }
}

async function createIntegrateResult(input: {
  ports: RuntimePorts & { github: GitHubPort }
  subjectId: string
}) {
  const commitSubject = input.ports.taskSource.buildCommitSubject(
    input.subjectId,
  )
  const branchName = toTaskBranchName(commitSubject)
  const openPr = await input.ports.github.findOpenPullRequestByHeadBranch({
    headBranch: branchName,
  })

  if (openPr) {
    await ensureTaskBranch(input.ports.git, branchName, true)
    const taskChecked = await input.ports.taskSource.isTaskCompleted(
      input.subjectId,
    )
    if (!taskChecked) {
      await finalizeTaskCheckbox({
        commitMessage: commitSubject,
        taskHandle: input.subjectId,
        runtime: {
          git: input.ports.git,
          github: input.ports.github,
          taskSource: input.ports.taskSource,
        } as OrchestratorRuntime,
      })
    }
    await input.ports.git.pushBranch(branchName)
    const mergeResult = await input.ports.github.squashMergePullRequest({
      pullRequestNumber: openPr.number,
      subject: commitSubject,
    })
    await cleanupBranch(input.ports.git, branchName)
    return {
      result: { kind: RunResult.IntegrateCompleted as const },
      artifact: makeArtifact(RunArtifactKind.IntegrateResult, input.subjectId, {
        commitSha: mergeResult.commitSha,
        prNumber: openPr.number,
      } satisfies IntegratePrPayload),
    }
  }

  const mergedPr = await input.ports.github.findMergedPullRequestByHeadBranch({
    headBranch: branchName,
  })
  if (!mergedPr) {
    throw new Error(
      `Missing open or merged pull request for branch ${branchName}`,
    )
  }

  await cleanupBranch(input.ports.git, branchName)
  return {
    result: { kind: RunResult.IntegrateAlreadyIntegrated as const },
    artifact: makeArtifact(RunArtifactKind.IntegrateResult, input.subjectId, {
      commitSha: mergedPr.mergeCommitSha,
      prNumber: mergedPr.number,
    } satisfies IntegratePrPayload),
  }
}

export function createRunPrProgram(deps: {
  implementer: AgentPort
  maxIterations: number
  ports: RuntimePorts & { github: GitHubPort }
  reviewPollIntervalMs?: number
  verifyCommands: string[]
  workspaceRoot: string
}): WorkflowProgram {
  const reviewPollIntervalMs = deps.reviewPollIntervalMs ?? 60_000
  const onError = errorRetry(deps.maxIterations)
  const steps = createSharedSteps({
    implementer: deps.implementer,
    ports: deps.ports,
    verifyCommands: deps.verifyCommands,
    workspaceRoot: deps.workspaceRoot,
    artifactKinds: {
      implementation: RunArtifactKind.Implementation,
      integrateResult: RunArtifactKind.IntegrateResult,
      reviewResult: RunArtifactKind.ReviewResult,
      verifyResult: RunArtifactKind.VerifyResult,
    },
  })
  const running = (nextPhase: RunPhase): Transition => ({
    nextPhase,
    status: TaskStatus.Running,
  })
  const done: Transition = { nextPhase: null, status: TaskStatus.Done }
  const replan: Transition = { nextPhase: null, status: TaskStatus.Replan }
  const retryImplementOrBlock: TransitionRule = ({ state }) =>
    retryBudgetReached(state, deps.maxIterations)
      ? { nextPhase: null, status: TaskStatus.Blocked }
      : running(RunPhase.Implement)

  return createWorkflowProgram(
    [
      {
        name: RunPhase.Implement,
        async run(ctx) {
          const reviewArtifact = ctx.artifacts.get<ReviewPayload>(
            RunArtifactKind.ReviewResult,
          )
          const lastFindings = reviewArtifact?.payload.findings ?? []
          const artifact = await steps.implement(ctx.subjectId, {
            attempt: ctx.state.iteration,
            lastFindings,
          })
          return {
            artifact,
            result: { kind: RunResult.ImplementationGenerated },
          }
        },
      },
      {
        name: RunPhase.Verify,
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
      },
      {
        name: RunPhase.Checkpoint,
        async run(ctx) {
          return createCheckpointResult({
            iteration: ctx.state.iteration,
            ports: deps.ports,
            subjectId: ctx.subjectId,
          })
        },
      },
      {
        name: RunPhase.Review,
        async run(ctx) {
          const checkpointArtifact = ctx.artifacts.get<CheckpointPayload>(
            RunArtifactKind.CheckpointResult,
          )
          const completionCriteria =
            await deps.ports.taskSource.getCompletionCriteria(ctx.subjectId)
          return createReviewResult({
            checkpoint: checkpointArtifact!.payload,
            completionCriteria,
            github: deps.ports.github,
            reviewPollIntervalMs,
            subjectId: ctx.subjectId,
          })
        },
      },
      {
        name: RunPhase.Integrate,
        async run(ctx) {
          return createIntegrateResult({
            ports: deps.ports,
            subjectId: ctx.subjectId,
          })
        },
      },
    ],
    {
      [RunPhase.Checkpoint]: {
        [KernelResultKind.Error]: onError(RunPhase.Checkpoint),
        [RunResult.CheckpointCreated]: running(RunPhase.Review),
      },
      [RunPhase.Implement]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.ImplementationGenerated]: running(RunPhase.Verify),
      },
      [RunPhase.Integrate]: {
        [KernelResultKind.Error]: onError(RunPhase.Integrate),
        [RunResult.IntegrateAlreadyIntegrated]: done,
        [RunResult.IntegrateCompleted]: done,
      },
      [RunPhase.Review]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.ReviewApproved]: running(RunPhase.Integrate),
        [RunResult.ReviewRejected]: retryImplementOrBlock,
        [RunResult.ReviewReplanRequired]: replan,
      },
      [RunPhase.Verify]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.VerifyFailed]: retryImplementOrBlock,
        [RunResult.VerifyPassed]: running(RunPhase.Checkpoint),
      },
    },
  )
}
