import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createImplement,
  createReview,
  createRuntime,
  createWorkflow,
  ScriptedWorkflowProvider,
} from './workflow-test-helpers'

test('runWorkflow stops scheduling after a task blocks the workflow', async () => {
  const graph = {
    featureId: '001-demo',
    maxIterations: 1,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
      {
        commitSubject: 'Task T002: Implement farewell',
        dependsOn: [],
        handle: 'T002',
      },
    ],
  }
  const { git, runtime } = createRuntime({
    changedFiles: [['src/greeting.ts'], ['src/farewell.ts']],
  })
  const provider = new ScriptedWorkflowProvider(
    [
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T002', 'src/farewell.ts'),
    ],
    [
      createReview('T001', 'buildGreeting works', 'blocked'),
      createReview('T002', 'buildFarewell works'),
    ],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.summary.finalStatus).toBe('blocked')
  expect(result.state.tasks.T001).toMatchObject({
    lastReviewVerdict: 'blocked',
    status: 'blocked',
  })
  expect(result.state.tasks.T002).toMatchObject({
    status: 'pending',
  })
  expect(provider.implementInputs).toHaveLength(1)
  expect(git.commitMessages).toEqual([])
})

test('runWorkflow rejects review outputs whose taskHandle does not match the current task', async () => {
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
  const { git, runtime, store } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T999', 'buildGreeting works')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.summary.finalStatus).toBe('blocked')
  expect(result.state.tasks.T001).toMatchObject({
    reason: 'Review taskHandle mismatch: expected T001, received T999',
    status: 'blocked',
  })
  expect(store.reviewArtifacts).toHaveLength(0)
  expect(git.commitMessages).toEqual([])
})

test('runWorkflow rejects implement outputs whose taskHandle does not match the current task', async () => {
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
  const { git, runtime, store } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T999', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )
  const workflow = createWorkflow(provider)

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(result.summary.finalStatus).toBe('blocked')
  expect(result.state.tasks.T001).toMatchObject({
    reason: 'Implement taskHandle mismatch: expected T001, received T999',
    status: 'blocked',
  })
  expect(store.implementArtifacts).toHaveLength(0)
  expect(provider.reviewInputs).toHaveLength(0)
  expect(git.commitMessages).toEqual([])
})
