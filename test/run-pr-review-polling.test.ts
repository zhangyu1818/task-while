import { describe, expect, test, vi } from 'vitest'

import { TaskStatus, type Artifact } from '../src/harness/state'
import {
  RunArtifactKind,
  RunPhase,
  RunResult,
} from '../src/programs/run-direct'
import {
  createRunPrProgram,
  type CheckpointPayload,
} from '../src/programs/run-pr'

import type { PullRequestSnapshot } from '../src/core/runtime'
import type {
  ActionNode,
  TypedArtifactMap,
  WorkflowNode,
} from '../src/harness/workflow-program'

function createSnapshot(
  input: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    changedFiles: ['src/greeting.ts'],
    discussionComments: [],
    reactions: [],
    reviewSummaries: [],
    reviewThreads: [],
    ...input,
  }
}

function createArtifacts(): TypedArtifactMap {
  const checkpointArtifact: Artifact<CheckpointPayload> = {
    id: 'checkpoint',
    kind: RunArtifactKind.CheckpointResult,
    subjectId: 'T001',
    timestamp: '2026-04-11T00:00:00.000Z',
    payload: {
      checkpointStartedAt: '2026-04-11T00:00:00.000Z',
      prNumber: 42,
    },
  }
  return {
    get<T = unknown>(kind: string) {
      if (kind === RunArtifactKind.CheckpointResult) {
        return checkpointArtifact as Artifact<T>
      }
      return undefined
    },
    has: (kind: string) => kind === RunArtifactKind.CheckpointResult,
    set() {},
  }
}

function createProgram(snapshots: PullRequestSnapshot[]) {
  const getPullRequestSnapshot = vi.fn(async () => snapshots.shift()!)
  const getCompletionCriteria = vi.fn(async () => ['greeting works'])
  const program = createRunPrProgram({
    implementer: {} as never,
    maxIterations: 5,
    reviewPollIntervalMs: 0,
    verifyCommands: ['echo ok'],
    workspaceRoot: '/tmp',
    ports: {
      git: {} as never,
      github: {
        createPullRequest: vi.fn(),
        findMergedPullRequestByHeadBranch: vi.fn(),
        findOpenPullRequestByHeadBranch: vi.fn(),
        getPullRequestSnapshot,
        squashMergePullRequest: vi.fn(),
      } as never,
      taskSource: {
        getCompletionCriteria,
      } as never,
    },
  })
  return { getCompletionCriteria, getPullRequestSnapshot, program }
}

function expectActionNode(node: undefined | WorkflowNode): ActionNode {
  expect(node).toBeDefined()
  if (!node) {
    throw new Error('Expected action node to be defined')
  }
  return node
}

describe('run-pr review polling', () => {
  test('keeps polling until approval', async () => {
    const { getCompletionCriteria, getPullRequestSnapshot, program } =
      createProgram([
        createSnapshot(),
        createSnapshot(),
        createSnapshot({
          reactions: [
            {
              content: '+1',
              createdAt: '2026-04-11T00:01:00.000Z',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        }),
      ])
    const node = expectActionNode(program.nodes[RunPhase.Review])

    const result = await node.run({
      artifacts: createArtifacts(),
      config: {},
      subjectId: 'T001',
      state: {
        artifacts: {},
        completedAt: null,
        currentPhase: RunPhase.Review,
        failureReason: null,
        iteration: 1,
        phaseIterations: {},
        status: TaskStatus.Running,
      },
    })

    expect(getCompletionCriteria).toHaveBeenCalledWith('T001')
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3)
    expect(result.result).toStrictEqual({ kind: RunResult.ReviewApproved })
  })

  test('keeps polling until rejection', async () => {
    const { getCompletionCriteria, getPullRequestSnapshot, program } =
      createProgram([
        createSnapshot(),
        createSnapshot({
          reviewThreads: [
            {
              id: 'thread-1',
              isOutdated: false,
              isResolved: false,
              comments: [
                {
                  body: 'Please fix greeting output',
                  createdAt: '2026-04-11T00:01:00.000Z',
                  line: 10,
                  path: 'src/greeting.ts',
                  url: 'https://example.com/thread-1',
                  userLogin: 'chatgpt-codex-connector[bot]',
                },
              ],
            },
          ],
        }),
      ])
    const node = expectActionNode(program.nodes[RunPhase.Review])

    const result = await node.run({
      artifacts: createArtifacts(),
      config: {},
      subjectId: 'T001',
      state: {
        artifacts: {},
        completedAt: null,
        currentPhase: RunPhase.Review,
        failureReason: null,
        iteration: 1,
        phaseIterations: {},
        status: TaskStatus.Running,
      },
    })

    expect(getCompletionCriteria).toHaveBeenCalledWith('T001')
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(2)
    expect(result.result).toStrictEqual({ kind: RunResult.ReviewRejected })
  })
})
