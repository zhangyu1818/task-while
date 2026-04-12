import { describe, expect, test, vi } from 'vitest'

import { TaskStatus, type Artifact } from '../src/harness/state'
import {
  WorkflowNodeType,
  type ActionNode,
  type TypedArtifactMap,
  type WorkflowNode,
} from '../src/harness/workflow-program'
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
import type { ContractPayload } from '../src/programs/shared-steps'

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
  const contractArtifact: Artifact<ContractPayload> = {
    id: 'contract',
    kind: RunArtifactKind.Contract,
    subjectId: 'T001',
    timestamp: '2026-04-11T00:00:00.000Z',
    payload: {
      completionCriteria: ['greeting works'],
      prompt: { instructions: [], sections: [] },
    },
  }
  return {
    get<T = unknown>(kind: string) {
      if (kind === RunArtifactKind.CheckpointResult) {
        return checkpointArtifact as Artifact<T>
      }
      if (kind === RunArtifactKind.Contract) {
        return contractArtifact as Artifact<T>
      }
      return undefined
    },
    has: (kind: string) =>
      kind === RunArtifactKind.CheckpointResult ||
      kind === RunArtifactKind.Contract,
    set() {},
  }
}

function createProgram(snapshots: PullRequestSnapshot[]) {
  const getPullRequestSnapshot = vi.fn(async () => snapshots.shift()!)
  const program = createRunPrProgram({
    implementer: {} as never,
    maxIterations: 5,
    reviewer: {} as never,
    reviewPollIntervalMs: 0,
    verifyCommands: ['echo ok'],
    workspaceRoot: '/tmp',
    ports: {
      git: {} as never,
      taskSource: {} as never,
      codeHost: {
        createPullRequest: vi.fn(),
        findMergedPullRequestByHeadBranch: vi.fn(),
        findOpenPullRequestByHeadBranch: vi.fn(),
        getPullRequestSnapshot,
        squashMergePullRequest: vi.fn(),
      } as never,
    },
  })
  return { getPullRequestSnapshot, program }
}

function expectActionNode(node: undefined | WorkflowNode): ActionNode {
  expect(node?.type).toBe(WorkflowNodeType.Action)
  if (node?.type !== WorkflowNodeType.Action) {
    throw new Error(`Expected action node, got ${node?.type ?? 'undefined'}`)
  }
  return node
}

describe('run-pr review polling', () => {
  test('keeps polling until approval', async () => {
    const { getPullRequestSnapshot, program } = createProgram([
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

    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(3)
    expect(result.result).toStrictEqual({ kind: RunResult.ReviewApproved })
  })

  test('keeps polling until rejection', async () => {
    const { getPullRequestSnapshot, program } = createProgram([
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

    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(2)
    expect(result.result).toStrictEqual({ kind: RunResult.ReviewRejected })
  })
})
