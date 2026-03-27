import type { OrchestratorRuntime } from '../core/runtime'

export interface FinalizeTaskCheckboxInput {
  commitMessage: string
  runtime: OrchestratorRuntime
  taskHandle: string
}

export async function finalizeTaskCheckbox(input: FinalizeTaskCheckboxInput) {
  try {
    await input.runtime.taskSource.applyTaskCompletion(input.taskHandle)
    return await input.runtime.git.commitTask({
      message: input.commitMessage,
    })
  } catch (error) {
    let reason = `Task commit failed: ${error instanceof Error ? error.message : String(error)}`
    try {
      await input.runtime.taskSource.revertTaskCompletion(input.taskHandle)
    } catch (rollbackError) {
      reason = `${reason}; task completion rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
    }
    throw new Error(reason)
  }
}
