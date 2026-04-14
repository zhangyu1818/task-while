export type TaskSourceName = 'openspec' | 'spec-kit'

export interface TaskPrompt {
  instructions: string[]
  sections: {
    content: string
    title: string
  }[]
}

export interface TaskSourceSession {
  applyTaskCompletion: (taskHandle: string) => Promise<void>
  buildCommitSubject: (taskHandle: string) => string
  buildImplementPrompt: (taskHandle: string) => Promise<TaskPrompt>
  buildReviewPrompt: (taskHandle: string) => Promise<TaskPrompt>
  getCompletionCriteria: (taskHandle: string) => Promise<string[]>
  isTaskCompleted: (taskHandle: string) => Promise<boolean>
  listTasks: () => string[]
  resolveTaskSelector: (selector: string) => string
  revertTaskCompletion: (taskHandle: string) => Promise<void>
}

export interface OpenTaskSourceInput {
  featureDir: string
  featureId: string
  workspaceRoot: string
}

export interface TaskSource {
  readonly name: TaskSourceName
  open: (input: OpenTaskSourceInput) => Promise<TaskSourceSession>
}
