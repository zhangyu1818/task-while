import type { TaskPrompt } from '../src/task-sources/types'

function deriveSpecKitCriterionFromTaskLine(taskLine: string) {
  const match = taskLine.match(
    /^- \[[ xX]\] T\d{3,}(?: \[P\])?(?: \[[A-Z]{2,}\d+\])? (.+)$/,
  )
  return match?.[1]?.trim() ?? taskLine.trim()
}

export function readSpecKitCompletionCriteriaFromPrompt(prompt: TaskPrompt) {
  const criteriaSection = prompt.sections.find(
    (section) => section.title === 'Completion Criteria',
  )
  if (criteriaSection) {
    return criteriaSection.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  const taskSection = prompt.sections.find(
    (section) => section.title === 'Task',
  )
  if (!taskSection) {
    return []
  }
  return [deriveSpecKitCriterionFromTaskLine(taskSection.content)]
}
