import type { PullRequestSnapshot } from '../core/runtime'

export interface CodeHostPort {
  createPullRequest: (input: {
    baseBranch: string
    body: string
    headBranch: string
    title: string
  }) => Promise<{ number: number; url: string }>
  findMergedPullRequestByHeadBranch: (input: {
    headBranch: string
  }) => Promise<null | { mergeCommitSha: string; number: number }>
  findOpenPullRequestByHeadBranch: (input: {
    headBranch: string
  }) => Promise<null | { number: number }>
  getPullRequestSnapshot: (input: {
    pullRequestNumber: number
  }) => Promise<PullRequestSnapshot>
  squashMergePullRequest: (input: {
    pullRequestNumber: number
    subject: string
  }) => Promise<{ commitSha: string }>
}
