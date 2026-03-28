import type { ImplementOutput, ReviewFinding } from '../types'

export type TaskSourceName = string

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
  buildImplementPrompt: (input: {
    attempt: number
    generation: number
    lastFindings: ReviewFinding[]
    taskHandle: string
  }) => Promise<TaskPrompt>
  buildReviewPrompt: (input: {
    actualChangedFiles: string[]
    attempt: number
    generation: number
    implement: ImplementOutput
    lastFindings: ReviewFinding[]
    taskHandle: string
  }) => Promise<TaskPrompt>
  getCompletionCriteria: (taskHandle: string) => Promise<string[]>
  getTaskDependencies: (taskHandle: string) => string[]
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
