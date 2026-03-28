import { finalizeTaskCheckbox } from './finalize-task-checkbox'

import type { ReviewerProvider } from '../agents/types'
import type { DirectWorkflowPreset } from './preset'

export interface CreateDirectWorkflowPresetInput {
  reviewer: ReviewerProvider
}

export function createDirectWorkflowPreset(
  input: CreateDirectWorkflowPresetInput,
): DirectWorkflowPreset {
  return {
    mode: 'direct',
    async integrate(context) {
      const { commitSha } = await finalizeTaskCheckbox({
        commitMessage: context.commitMessage,
        runtime: context.runtime,
        taskHandle: context.taskHandle,
      })
      return {
        kind: 'completed',
        result: {
          commitSha,
          summary: 'integrated',
        },
      }
    },
    async review(context) {
      const review = await input.reviewer.review({
        actualChangedFiles: context.actualChangedFiles,
        attempt: context.attempt,
        generation: context.generation,
        implement: context.implement,
        lastFindings: context.lastFindings,
        prompt: context.prompt,
        taskHandle: context.taskHandle,
      })
      return review.verdict === 'pass'
        ? { kind: 'approved', review }
        : { kind: 'rejected', review }
    },
  }
}
