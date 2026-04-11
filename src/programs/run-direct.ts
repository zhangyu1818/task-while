import { errorRetry, KernelResultKind } from '../harness/kernel'
import { TaskStatus } from '../harness/state'
import { action, sequence } from '../harness/workflow-builders'
import {
  createSharedSteps,
  type ContractPayload,
  type ImplementPayload,
  type ReviewPayload,
  type RuntimePorts,
  type SharedSteps,
} from './shared-steps'

import type { WorkflowProgram } from '../harness/workflow-program'
import type { AgentPort } from '../ports/agent'

export enum RunPhase {
  Checkpoint = 'checkpoint',
  Contract = 'contract',
  Implement = 'implement',
  Integrate = 'integrate',
  Review = 'review',
  Verify = 'verify',
}

export enum RunResult {
  CheckpointCreated = 'checkpoint.created',
  ContractGenerated = 'contract.generated',
  ImplementationGenerated = 'implementation.generated',
  IntegrateAlreadyIntegrated = 'integrate.already_integrated',
  IntegrateCompleted = 'integrate.completed',
  ReviewApproved = 'review.approved',
  ReviewPending = 'review.pending',
  ReviewRejected = 'review.rejected',
  ReviewReplanRequired = 'review.replan_required',
  VerifyFailed = 'verify.failed',
  VerifyPassed = 'verify.passed',
}

export enum RunArtifactKind {
  CheckpointResult = 'checkpoint_result',
  Contract = 'contract',
  Implementation = 'implementation',
  IntegrateResult = 'integrate_result',
  ReviewResult = 'review_result',
  VerifyResult = 'verify_result',
}

export function createRunDirectProgram(deps: {
  implementer: AgentPort
  maxIterations: number
  ports: RuntimePorts
  reviewer: AgentPort
  verifyCommands: string[]
  workspaceRoot: string
}): WorkflowProgram {
  const { maxIterations } = deps
  const onError = errorRetry(maxIterations)
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
      action(RunPhase.Review, {
        async run(ctx) {
          const implArtifact = ctx.artifacts.get<ImplementPayload>(
            RunArtifactKind.Implementation,
          )
          const reviewArtifact = ctx.artifacts.get<ReviewPayload>(
            RunArtifactKind.ReviewResult,
          )
          const lastFindings = reviewArtifact?.payload.findings ?? []
          const artifact = await steps.review(ctx.subjectId, {
            attempt: ctx.state.iteration,
            implement: implArtifact!.payload,
            lastFindings,
          })
          const verdict = artifact.payload.verdict
          const kind =
            verdict === 'approved'
              ? RunResult.ReviewApproved
              : verdict === 'replan_required'
                ? RunResult.ReviewReplanRequired
                : RunResult.ReviewRejected
          return { artifact, result: { kind } }
        },
      }),
      action(RunPhase.Integrate, {
        async run(ctx) {
          const artifact = await steps.integrate(ctx.subjectId)
          return {
            artifact,
            result: { kind: RunResult.IntegrateCompleted },
          }
        },
      }),
    ],
    {
      [RunPhase.Contract]: {
        [KernelResultKind.Error]: onError(RunPhase.Contract),
        [RunResult.ContractGenerated]: {
          nextPhase: RunPhase.Implement,
          status: TaskStatus.Running,
        },
      },
      [RunPhase.Implement]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.ImplementationGenerated]: {
          nextPhase: RunPhase.Verify,
          status: TaskStatus.Running,
        },
      },
      [RunPhase.Integrate]: {
        [KernelResultKind.Error]: onError(RunPhase.Integrate),
        [RunResult.IntegrateCompleted]: {
          nextPhase: null,
          status: TaskStatus.Done,
        },
      },
      [RunPhase.Review]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.ReviewApproved]: {
          nextPhase: RunPhase.Integrate,
          status: TaskStatus.Running,
        },
        [RunResult.ReviewReplanRequired]: {
          nextPhase: null,
          status: TaskStatus.Replan,
        },
        [RunResult.ReviewRejected]: (input) =>
          (input.state.phaseIterations[RunPhase.Implement] ?? 0) >=
          maxIterations
            ? { nextPhase: null, status: TaskStatus.Blocked }
            : { nextPhase: RunPhase.Implement, status: TaskStatus.Running },
      },
      [RunPhase.Verify]: {
        [KernelResultKind.Error]: onError(RunPhase.Implement),
        [RunResult.VerifyPassed]: {
          nextPhase: RunPhase.Review,
          status: TaskStatus.Running,
        },
        [RunResult.VerifyFailed]: (input) =>
          (input.state.phaseIterations[RunPhase.Implement] ?? 0) >=
          maxIterations
            ? { nextPhase: null, status: TaskStatus.Blocked }
            : { nextPhase: RunPhase.Implement, status: TaskStatus.Running },
      },
    },
  )
}
