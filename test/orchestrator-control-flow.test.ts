import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createReview,
  createRuntime,
  createWorkflow,
  ScriptedWorkflowProvider,
} from './workflow-test-helpers'

test('runWorkflow records review execution failures and blocks when max attempts are exhausted', async () => {
  const graph = {
    featureId: '001-demo',
    maxIterations: 1,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
    ],
  }
  const { runtime, store } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [new Error('review crashed')],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'review crashed',
    status: 'blocked',
  })
  expect(store.events.some((event) => event.type === 'review_failed')).toBe(
    true,
  )
  expect(store.reviewArtifacts).toHaveLength(0)
})

test('runWorkflow stops after untilTaskId completes and leaves downstream tasks untouched', async () => {
  const graph = createGraph()
  const { runtime, store, workspace } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    untilTaskHandle: 'T001',
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(store.implementArtifacts).toHaveLength(1)
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskHandle: 'T001' }],
  ])
})

test('runWorkflow returns immediately when untilTaskId is already completed in persisted state', async () => {
  const graph = createGraph()
  const { runtime, store } = createRuntime()
  store.state = {
    currentTaskHandle: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        commitSha: 'commit-1',
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass',
        status: 'done',
      },
      T002: {
        attempt: 0,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        status: 'pending',
      },
    },
  }
  const provider = new ScriptedWorkflowProvider([], [])

  const result = await runWorkflow({
    graph,
    runtime,
    untilTaskHandle: 'T001',
    workflow: createWorkflow(provider),
  })

  expect(result.summary.finalStatus).toBe('in_progress')
  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(provider.implementInputs).toEqual([])
  expect(provider.reviewInputs).toEqual([])
})
