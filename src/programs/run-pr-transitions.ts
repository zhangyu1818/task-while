import { KernelResultKind } from '../harness/kernel'
import { RunPhase, RunResult } from './run-direct'

import type { Transition, TransitionRule } from '../harness/workflow-program'

export function createRunPrTransitions(input: {
  done: Transition
  onError: (retryPhase: string) => TransitionRule
  replan: Transition
  retryImplementOrBlock: TransitionRule
  running: (nextPhase: RunPhase) => Transition
}) {
  return {
    [RunPhase.Checkpoint]: {
      [KernelResultKind.Error]: input.onError(RunPhase.Checkpoint),
      [RunResult.CheckpointCreated]: input.running(RunPhase.Review),
    },
    [RunPhase.Implement]: {
      [KernelResultKind.Error]: input.onError(RunPhase.Implement),
      [RunResult.ImplementationGenerated]: input.running(RunPhase.Verify),
    },
    [RunPhase.Integrate]: {
      [KernelResultKind.Error]: input.onError(RunPhase.Integrate),
      [RunResult.IntegrateAlreadyIntegrated]: input.done,
      [RunResult.IntegrateCompleted]: input.done,
    },
    [RunPhase.Review]: {
      [KernelResultKind.Error]: input.onError(RunPhase.Implement),
      [RunResult.ReviewApproved]: input.running(RunPhase.Integrate),
      [RunResult.ReviewRejected]: input.retryImplementOrBlock,
      [RunResult.ReviewReplanRequired]: input.replan,
    },
    [RunPhase.Verify]: {
      [KernelResultKind.Error]: input.onError(RunPhase.Implement),
      [RunResult.VerifyFailed]: input.retryImplementOrBlock,
      [RunResult.VerifyPassed]: input.running(RunPhase.Checkpoint),
    },
  }
}
