import {
  alignStateWithGraph,
  createInitialWorkflowState,
  selectNextRunnableTask,
} from './engine'
import { appendEvent, now, persistState } from './orchestrator-helpers'
import { resumePullRequestIntegrate } from './orchestrator-integrate-resume'
import { resumePullRequestReview } from './orchestrator-review-resume'
import { executeTaskAttempt } from './orchestrator-task-attempt'

import type { FinalReport, TaskGraph, WorkflowState } from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export interface WorkflowRunResult {
  state: WorkflowState
  summary: FinalReport['summary']
}

export interface RunWorkflowInput {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  untilTaskHandle?: string
  workflow: WorkflowRuntime
}

export interface RewindTaskInput {
  loadGraph: () => Promise<TaskGraph>
  runtime: OrchestratorRuntime
  taskHandle: string
}

export async function runWorkflow(
  input: RunWorkflowInput,
): Promise<WorkflowRunResult> {
  const workflow = input.workflow
  const isPullRequestMode = workflow.preset.mode === 'pull-request'
  await input.runtime.store.saveGraph(input.graph)
  const storedState = await input.runtime.store.loadState()
  let state = alignStateWithGraph(
    input.graph,
    storedState ?? createInitialWorkflowState(input.graph),
    {
      preserveRunningIntegrate: isPullRequestMode,
      preserveRunningReview: isPullRequestMode,
    },
  )
  let report = await persistState(input.runtime, input.graph, state)

  while (
    report.summary.finalStatus !== 'blocked' &&
    report.summary.finalStatus !== 'replan_required'
  ) {
    if (
      input.untilTaskHandle &&
      state.tasks[input.untilTaskHandle]?.status === 'done'
    ) {
      break
    }

    const resumedIntegrate = await resumePullRequestIntegrate({
      graph: input.graph,
      runtime: input.runtime,
      state,
      workflow,
    })
    if (resumedIntegrate) {
      report = resumedIntegrate.report
      state = resumedIntegrate.state
      continue
    }

    const resumedReview = await resumePullRequestReview({
      graph: input.graph,
      runtime: input.runtime,
      state,
      workflow,
    })
    if (resumedReview) {
      report = resumedReview.report
      state = resumedReview.state
      continue
    }

    const task = selectNextRunnableTask(input.graph, state)
    if (!task) {
      break
    }

    const next = await executeTaskAttempt({
      graph: input.graph,
      runtime: input.runtime,
      state,
      taskHandle: task,
      workflow,
    })
    report = next.report
    state = next.state
  }

  return {
    state,
    summary: report.summary,
  }
}

export async function rewindTask(input: RewindTaskInput) {
  const state = await input.runtime.store.loadState()
  if (!state) {
    throw new Error('Cannot rewind before workflow state exists')
  }
  const targetTask = state.tasks[input.taskHandle]
  if (targetTask?.status !== 'done') {
    throw new Error(
      `Task ${input.taskHandle} is not completed and cannot be rewound`,
    )
  }

  const parentCommit = await input.runtime.git.getParentCommit(
    targetTask.commitSha,
  )
  await input.runtime.git.resetHard(parentCommit)
  await input.runtime.store.reset()

  const graph = await input.loadGraph()
  const nextState = createInitialWorkflowState(graph)
  const rewoundTaskIds: string[] = []

  for (const task of graph.tasks) {
    const previousTask = state.tasks[task.handle]
    if (!previousTask) {
      continue
    }
    if (previousTask.status === 'done') {
      const isAncestorOfHead = await input.runtime.git.isAncestorOfHead(
        previousTask.commitSha,
      )
      if (isAncestorOfHead) {
        nextState.tasks[task.handle] = previousTask
        continue
      }
      rewoundTaskIds.push(task.handle)
      nextState.tasks[task.handle] = {
        attempt: 0,
        generation: previousTask.generation + 1,
        lastFindings: [],
        status: 'pending',
        invalidatedBy:
          task.handle === input.taskHandle ? null : input.taskHandle,
      }
    }
  }

  await input.runtime.store.saveGraph(graph)
  for (const taskId of rewoundTaskIds) {
    const taskState = nextState.tasks[taskId]!
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskHandle: taskId,
      timestamp: now(),
      type: taskId === input.taskHandle ? 'task_rewound' : 'task_invalidated',
      detail:
        taskId === input.taskHandle
          ? 'rewound manually'
          : `invalidated by rewind of ${input.taskHandle}`,
    })
  }
  await persistState(input.runtime, graph, nextState)
  return nextState
}
