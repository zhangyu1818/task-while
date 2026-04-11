import type { TaskPrompt } from '../src/task-sources/types'

export interface PerTaskPromptSource {
  kind: 'per-task'
  value: Record<string, TaskPrompt>
}

export interface SinglePromptSource {
  kind: 'single'
  value: TaskPrompt
}

export type TaskPromptSource = PerTaskPromptSource | SinglePromptSource

export interface CheckoutBranchOptions {
  create?: boolean
  startPoint?: string
}

export interface CommitTaskInput {
  message: string
}

export class FakeGit {
  private commitIndex = 0

  private headSubject: string
  public readonly commitMessages: string[] = []
  public readonly currentBranches = ['main']

  public constructor(
    private readonly changedFiles: string[][] = [[], []],
    private readonly commitFailures: (Error | null)[] = [],
    headSubject = 'Initial commit',
  ) {
    this.headSubject = headSubject
  }

  public async checkoutBranch(name: string, options?: CheckoutBranchOptions) {
    if (
      options?.create &&
      options.startPoint &&
      !this.currentBranches.includes(options.startPoint)
    ) {
      throw new Error(`Missing branch ${options.startPoint}`)
    }
    this.currentBranches.push(name)
  }

  public async checkoutRemoteBranch(name: string) {
    this.currentBranches.push(name)
  }

  public async commitTask(input: CommitTaskInput) {
    const failure = this.commitFailures.shift() ?? null
    if (failure) {
      throw failure
    }
    this.commitMessages.push(input.message)
    this.headSubject = input.message
    this.commitIndex += 1
    return { commitSha: `commit-${this.commitIndex}` }
  }

  public async deleteLocalBranch(name: string) {
    if (this.currentBranches.at(-1) === name) {
      throw new Error(`Cannot delete checked out branch ${name}`)
    }
  }

  public async getChangedFilesSinceHead() {
    return this.changedFiles.shift() ?? []
  }

  public async getCurrentBranch() {
    return this.currentBranches.at(-1) ?? 'main'
  }

  public async getHeadSha() {
    return `head-${this.commitIndex}`
  }

  public async getHeadSubject() {
    return this.headSubject
  }

  public async getHeadTimestamp() {
    return '2026-03-25T08:00:00.000Z'
  }

  public async pullFastForward() {}

  public async pushBranch() {}

  public async requireCleanWorktree() {}
}
