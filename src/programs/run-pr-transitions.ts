import { errorRetry, KernelResultKind } from '../harness/kernel'
import { TaskStatus } from '../harness/state'
import { RunPhase, RunResult } from './run-direct'

import type {
  TransitionRule,
  WorkflowProgram,
} from '../harness/workflow-program'

function retryImplement(maxIterations: number): TransitionRule {
  return (input) =>
    (input.state.phaseIterations[RunPhase.Implement] ?? 0) >= maxIterations
      ? { nextPhase: null, status: TaskStatus.Blocked }
      : { nextPhase: RunPhase.Implement, status: TaskStatus.Running }
}

export function createRunPrTransitions(
  maxIterations: number,
): WorkflowProgram['transitions'] {
  const onError = errorRetry(maxIterations)
  const retryImplementRule = retryImplement(maxIterations)

  return {
    [RunPhase.Checkpoint]: {
      [KernelResultKind.Error]: onError(RunPhase.Checkpoint),
      [RunResult.CheckpointCreated]: {
        nextPhase: RunPhase.Review,
        status: TaskStatus.Running,
      },
    },
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
      [RunResult.IntegrateAlreadyIntegrated]: {
        nextPhase: null,
        status: TaskStatus.Done,
      },
      [RunResult.IntegrateCompleted]: {
        nextPhase: null,
        status: TaskStatus.Done,
      },
    },
    [RunPhase.Review]: {
      [KernelResultKind.Error]: onError(RunPhase.Implement),
      [RunResult.ReviewRejected]: retryImplementRule,
      [RunResult.ReviewApproved]: {
        nextPhase: RunPhase.Integrate,
        status: TaskStatus.Running,
      },
      [RunResult.ReviewPending]: {
        nextPhase: RunPhase.Review,
        status: TaskStatus.Suspended,
      },
      [RunResult.ReviewReplanRequired]: {
        nextPhase: null,
        status: TaskStatus.Replan,
      },
    },
    [RunPhase.Verify]: {
      [KernelResultKind.Error]: onError(RunPhase.Implement),
      [RunResult.VerifyFailed]: retryImplementRule,
      [RunResult.VerifyPassed]: {
        nextPhase: RunPhase.Checkpoint,
        status: TaskStatus.Running,
      },
    },
  }
}
