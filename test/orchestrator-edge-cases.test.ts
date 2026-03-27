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

test('runWorkflow does not mechanically block when changed files extend beyond the original task scope', async () => {
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
  const { git, runtime, store, workspace } = createRuntime({
    changedFiles: [['src/greeting.ts', 'src/outside.ts']],
  })
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [
      {
        findings: [],
        overallRisk: 'low',
        summary: 'review passed with additional related files',
        taskHandle: 'T001',
        verdict: 'pass',
        acceptanceChecks: [
          {
            criterion: 'buildGreeting works',
            note: 'core behavior is correct',
            status: 'pass',
          },
        ],
      },
    ],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(provider.reviewInputs[0]?.actualChangedFiles).toEqual([
    'src/greeting.ts',
    'src/outside.ts',
  ])
  expect(result.summary.finalStatus).toBe('completed')
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    lastReviewVerdict: 'pass',
    status: 'done',
  })
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskHandle: 'T001' }],
  ])
  expect(git.commitMessages).toEqual(['Task T001: Implement greeting'])
  expect(store.reviewArtifacts).toHaveLength(1)
})

test('runWorkflow preserves implement artifacts when review fails and blocks after max attempts', async () => {
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
    [new Error('review output invalid')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'review output invalid',
    status: 'blocked',
  })
  expect(store.implementArtifacts).toHaveLength(1)
  expect(store.reviewArtifacts).toHaveLength(0)
})

test('runWorkflow treats task checkbox write failures as recoverable commit failures', async () => {
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
  const { git, runtime, workspace } = createRuntime()
  const originalUpdateTaskChecks = workspace.updateTaskChecks.bind(workspace)
  workspace.updateTaskChecks = async (updates) => {
    if (updates[0]?.completed) {
      throw new Error('disk full')
    }
    await originalUpdateTaskChecks(updates)
  }
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'Task commit failed: disk full',
    status: 'blocked',
  })
  expect(git.commitMessages).toEqual([])
})

test('runWorkflow aligns persisted state with newly added tasks before saving reports', async () => {
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
    },
  }
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T002', 'src/farewell.ts')],
    [createReview('T002', 'buildFarewell works')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'done' })
  expect(store.report?.tasks.map((task) => task.taskHandle)).toEqual([
    'T001',
    'T002',
  ])
})

test('runWorkflow requeues persisted running tasks so interrupted attempts can resume', async () => {
  const graph = {
    featureId: '001-demo',
    maxIterations: 2,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
    ],
  }
  const { runtime, store } = createRuntime()
  store.state = {
    currentTaskHandle: 'T001',
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        stage: 'review',
        status: 'running',
      },
    },
  }
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(provider.implementInputs).toHaveLength(1)
})
