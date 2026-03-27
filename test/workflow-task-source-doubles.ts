import { readSpecKitCompletionCriteriaFromPrompt } from './spec-kit-task-source-test-helpers'

import type { TaskSourceSession } from '../src/task-sources/types'
import type { ImplementOutput, ReviewFinding, TaskGraph } from '../src/types'
import type { TaskPromptSource } from './workflow-runtime-doubles'

export interface CompletionUpdate {
  checked?: boolean
  completed: boolean
  taskHandle: string
}

export class InMemoryWorkspace {
  public readonly completionUpdates: CompletionUpdate[][] = []
  public constructor(public readonly prompts: TaskPromptSource) {}
  public get checkboxUpdates() {
    return this.completionUpdates.map((updates) =>
      updates.map((update) => ({
        checked: update.completed,
        taskHandle: update.taskHandle,
      })),
    )
  }
  public async isTaskChecked(taskHandle: string) {
    const latest = this.completionUpdates
      .flat()
      .findLast((item) => item.taskHandle === taskHandle)
    return latest?.completed ?? false
  }

  public async updateTaskChecks(updates: CompletionUpdate[]) {
    this.completionUpdates.push(
      updates.map((update) => ({
        checked: update.checked ?? update.completed,
        completed: update.completed,
        taskHandle: update.taskHandle,
      })),
    )
  }
}

export class InMemoryTaskSource implements TaskSourceSession {
  public constructor(
    private readonly graph: TaskGraph,
    private readonly prompts: TaskPromptSource,
    private readonly workspace: InMemoryWorkspace,
  ) {}

  private async getPrompt(taskHandle: string) {
    if (this.prompts.kind === 'single') {
      return this.prompts.value
    }
    const prompt = this.prompts.value[taskHandle]
    if (!prompt) {
      throw new Error(`Missing task prompt for ${taskHandle}`)
    }
    return prompt
  }

  private getTask(taskHandle: string) {
    const task = this.graph.tasks.find((item) => item.handle === taskHandle)
    if (!task) {
      throw new Error(`Unknown task selector: ${taskHandle}`)
    }
    return task
  }

  public async applyTaskCompletion(taskHandle: string) {
    if (await this.isTaskCompleted(taskHandle)) {
      return
    }
    await this.workspace.updateTaskChecks([
      { checked: true, completed: true, taskHandle },
    ])
  }

  public buildCommitSubject(taskHandle: string) {
    return this.getTask(taskHandle).commitSubject
  }

  public async buildImplementPrompt(input: {
    attempt: number
    generation: number
    lastFindings: ReviewFinding[]
    taskHandle: string
  }) {
    const { taskHandle, ...unused } = input
    void unused
    return this.getPrompt(taskHandle)
  }

  public async buildReviewPrompt(input: {
    actualChangedFiles: string[]
    attempt: number
    generation: number
    implement: ImplementOutput
    lastFindings: ReviewFinding[]
    taskHandle: string
  }) {
    const { taskHandle, ...unused } = input
    void unused
    return this.getPrompt(taskHandle)
  }

  public async getCompletionCriteria(taskHandle: string) {
    const prompt = await this.getPrompt(taskHandle)
    return readSpecKitCompletionCriteriaFromPrompt(prompt)
  }

  public getTaskDependencies(taskHandle: string) {
    return this.getTask(taskHandle).dependsOn
  }

  public async isTaskCompleted(taskHandle: string) {
    return this.workspace.isTaskChecked(taskHandle)
  }

  public listTasks() {
    return this.graph.tasks.map((task) => task.handle)
  }

  public resolveTaskSelector(selector: string) {
    return this.getTask(selector).handle
  }

  public async revertTaskCompletion(taskHandle: string) {
    if (!(await this.isTaskCompleted(taskHandle))) {
      return
    }
    await this.workspace.updateTaskChecks([
      { checked: false, completed: false, taskHandle },
    ])
  }
}
