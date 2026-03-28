import type { TaskPrompt } from '../src/task-sources/types'

export interface CreateTaskPromptInput {
  completionCriteria?: string[]
  instructions?: string[]
  phase?: string
  plan?: string
  spec?: string
  taskHandle?: string
  taskLine?: string
  tasksSnippet?: string
  title?: string
}

export function createTaskPrompt(
  input: CreateTaskPromptInput = {},
): TaskPrompt {
  const taskHandle = input.taskHandle ?? 'T001'
  const title = input.title ?? 'Do work'
  const taskLine = input.taskLine ?? `- [ ] ${taskHandle} ${title}`

  return {
    instructions: input.instructions ?? [],
    sections: [
      {
        content: taskLine,
        title: 'Task',
      },
      { content: input.phase ?? 'Phase 1: Core', title: 'Phase' },
      { content: input.spec ?? '# spec', title: 'Spec' },
      { content: input.plan ?? '# plan', title: 'Plan' },
      {
        content: input.tasksSnippet ?? taskLine,
        title: 'Tasks',
      },
      ...(input.completionCriteria
        ? [
            {
              content: input.completionCriteria.join('\n'),
              title: 'Completion Criteria',
            },
          ]
        : []),
    ],
  }
}
