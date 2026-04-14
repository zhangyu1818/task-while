import type { GitHubPort, GitPort } from '../core/runtime'
import type { TaskSourceSession } from '../task-sources/types'

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export function toTaskBranchName(commitSubject: string) {
  const slug = commitSubject
    .replace(/^Task\s+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `task/${slug}`
}

export async function ensureTaskBranch(
  git: GitPort,
  branchName: string,
  restoreFromRemote: boolean,
) {
  const currentBranch = await git.getCurrentBranch()
  if (currentBranch === branchName) {
    return
  }
  try {
    await git.checkoutBranch(branchName)
  } catch {
    if (restoreFromRemote) {
      await git.checkoutRemoteBranch(branchName)
      return
    }
    await git.checkoutBranch(branchName, {
      create: true,
      startPoint: 'main',
    })
  }
}

export async function runPrCheckpoint(
  ports: { git: GitPort; github: GitHubPort },
  taskSource: TaskSourceSession,
  input: { iteration: number; subjectId: string },
): Promise<{ checkpointStartedAt: string; prNumber: number }> {
  const commitSubject = taskSource.buildCommitSubject(input.subjectId)
  const branchName = toTaskBranchName(commitSubject)
  const existingPr = await ports.github.findOpenPullRequestByHeadBranch({
    headBranch: branchName,
  })

  await ensureTaskBranch(ports.git, branchName, existingPr !== null)

  const checkpointMessage = `checkpoint: ${commitSubject} (attempt ${input.iteration})`
  const headSubject = await ports.git.getHeadSubject()
  if (headSubject !== checkpointMessage) {
    await ports.git.commitTask({ message: checkpointMessage })
  }

  await ports.git.pushBranch(branchName)

  let pullRequest = existingPr
  if (!pullRequest) {
    pullRequest = await ports.github.createPullRequest({
      baseBranch: 'main',
      body: `Task: ${commitSubject}\nManaged by task-while.`,
      headBranch: branchName,
      title: commitSubject,
    })
  }

  const checkpointStartedAt = await ports.git.getHeadTimestamp()
  return { checkpointStartedAt, prNumber: pullRequest.number }
}

export async function cleanupBranch(git: GitPort, branchName: string) {
  try {
    await git.checkoutBranch('main')
    await git.pullFastForward('main')
    await git.deleteLocalBranch(branchName)
  } catch {}
}
