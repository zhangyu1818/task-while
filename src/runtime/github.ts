import { execa } from 'execa'

import {
  getPullRequestSnapshotViaGraphQL,
  type RunGh,
} from './github-pr-snapshot'

import type {
  CreatePullRequestInput,
  FindMergedPullRequestByHeadBranchInput,
  FindOpenPullRequestByHeadBranchInput,
  GetPullRequestSnapshotInput,
  GitHubPort,
  MergedPullRequestRef,
  PullRequestRef,
  PullRequestSnapshot,
  SquashMergePullRequestInput,
} from '../core/runtime'

async function defaultRunGh(args: string[], cwd: string) {
  const env = process.env.GITHUB_BOT_TOKEN
    ? {
        ...process.env,
        GH_TOKEN: process.env.GITHUB_BOT_TOKEN,
      }
    : process.env
  const result = await execa('gh', args, { cwd, env })
  return result.stdout.trim()
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

interface LoginLike {
  login?: unknown
}

interface MergeCommitLike {
  oid?: unknown
}

interface RepoViewPayload {
  nameWithOwner?: unknown
}

function asOwnerLogin(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'login' in value) {
    return asString((value as LoginLike).login)
  }
  return ''
}

export class GitHubRuntime implements GitHubPort {
  private readonly runGh: RunGh

  public constructor(
    workspaceRoot: string,
    runGh?: RunGh,
    private readonly repoName?: string,
  ) {
    this.runGh = runGh ?? ((args) => defaultRunGh(args, workspaceRoot))
  }

  private async resolveRepo() {
    if (this.repoName) {
      return this.repoName
    }
    const payload = JSON.parse(
      await this.runGh(['repo', 'view', '--json', 'nameWithOwner']),
    ) as RepoViewPayload
    return asString(payload.nameWithOwner)
  }

  private async resolveRepoOwner() {
    const repo = await this.resolveRepo()
    const [owner] = repo.split('/')
    if (!owner) {
      throw new Error(`Invalid GitHub repository name: ${repo}`)
    }
    return owner
  }

  public async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestRef> {
    await this.runGh([
      'pr',
      'create',
      '--base',
      input.baseBranch,
      '--head',
      input.headBranch,
      '--title',
      input.title,
      '--body',
      input.body,
    ])
    const created = await this.findOpenPullRequestByHeadBranch({
      headBranch: input.headBranch,
    })
    if (!created) {
      throw new Error(
        `Could not resolve pull request after creating branch ${input.headBranch}`,
      )
    }
    return created
  }

  public async findMergedPullRequestByHeadBranch(
    input: FindMergedPullRequestByHeadBranchInput,
  ): Promise<MergedPullRequestRef | null> {
    const owner = await this.resolveRepoOwner()
    const payload = JSON.parse(
      await this.runGh([
        'pr',
        'list',
        '--head',
        input.headBranch,
        '--state',
        'merged',
        '--json',
        'number,title,url,mergeCommit,headRefName,headRepositoryOwner',
      ]),
    )
    const pullRequests = asArray<Record<string, unknown>>(payload)
    const match =
      pullRequests.find(
        (candidate) =>
          asString(candidate.headRefName) === input.headBranch &&
          asOwnerLogin(candidate.headRepositoryOwner) === owner,
      ) ?? null
    if (!match) {
      return null
    }
    const mergeCommit = match.mergeCommit
    const mergeCommitSha =
      mergeCommit && typeof mergeCommit === 'object' && 'oid' in mergeCommit
        ? asString((mergeCommit as MergeCommitLike).oid)
        : ''
    if (!mergeCommitSha) {
      throw new Error(
        `Merged pull request for branch ${input.headBranch} is missing mergeCommit`,
      )
    }
    return {
      mergeCommitSha,
      number: asNumber(match.number),
      title: asString(match.title),
      url: asString(match.url),
    }
  }

  public async findOpenPullRequestByHeadBranch(
    input: FindOpenPullRequestByHeadBranchInput,
  ): Promise<null | PullRequestRef> {
    const owner = await this.resolveRepoOwner()
    const payload = JSON.parse(
      await this.runGh([
        'pr',
        'list',
        '--head',
        input.headBranch,
        '--state',
        'open',
        '--json',
        'number,title,url,headRefName,headRepositoryOwner',
      ]),
    )
    const pullRequests = asArray<Record<string, unknown>>(payload)
    const match =
      pullRequests.find(
        (candidate) =>
          asString(candidate.headRefName) === input.headBranch &&
          asOwnerLogin(candidate.headRepositoryOwner) === owner,
      ) ?? null
    if (!match) {
      return null
    }
    return {
      number: asNumber(match.number),
      title: asString(match.title),
      url: asString(match.url),
    }
  }

  public async getPullRequestSnapshot(
    input: GetPullRequestSnapshotInput,
  ): Promise<PullRequestSnapshot> {
    const repo = await this.resolveRepo()
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) {
      throw new Error(`Invalid GitHub repository name: ${repo}`)
    }
    return getPullRequestSnapshotViaGraphQL({
      owner,
      pullRequestNumber: input.pullRequestNumber,
      repo: repoName,
      runGh: this.runGh,
    })
  }

  public async squashMergePullRequest(input: SquashMergePullRequestInput) {
    const repo = await this.resolveRepo()
    const commitSha = asString(
      JSON.parse(
        await this.runGh([
          'api',
          `repos/${repo}/pulls/${input.pullRequestNumber}/merge`,
          '--method',
          'PUT',
          '-f',
          'merge_method=squash',
          '-f',
          `commit_title=${input.subject}`,
        ]),
      ).sha,
    )
    return { commitSha }
  }
}
