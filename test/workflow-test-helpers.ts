import { createTaskPrompt } from './task-source-test-helpers'
import { FakeGitHub } from './workflow-github-double'
import { FakeGit } from './workflow-runtime-doubles'
import {
  InMemoryTaskSource,
  InMemoryWorkspace,
  type TestTaskGraph,
} from './workflow-task-source-doubles'

import type { OrchestratorRuntime } from '../src/core/runtime'

export function createGraph(): TestTaskGraph {
  return {
    featureId: '001-demo',
    maxIterations: 5,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
      {
        commitSubject: 'Task T002: Implement farewell',
        dependsOn: ['T001'],
        handle: 'T002',
      },
    ],
  }
}

export interface CreateRuntimeInput {
  changedFiles?: string[][]
  commitFailures?: (Error | null)[]
  taskContexts?: Record<
    string,
    {
      plan: string
      spec: string
      tasksSnippet: string
    }
  >
  taskPrompts?: Record<string, ReturnType<typeof createTaskPrompt>>
}

export interface RuntimeBundle {
  git: FakeGit
  runtime: OrchestratorRuntime
  workspace: InMemoryWorkspace
}

export function createRuntime(input?: CreateRuntimeInput): RuntimeBundle {
  const workspace = new InMemoryWorkspace({
    kind: 'per-task',
    value:
      input?.taskPrompts ??
      Object.fromEntries(
        Object.entries(
          input?.taskContexts ?? {
            T001: {
              plan: '# plan\n',
              spec: '# spec\n',
              tasksSnippet: '- [ ] T001 Implement greeting\n',
            },
            T002: {
              plan: '# plan\n',
              spec: '# spec\n',
              tasksSnippet: '- [ ] T002 Implement farewell\n',
            },
          },
        ).map(([taskHandle, context]) => [
          taskHandle,
          createTaskPrompt({
            instructions: ['Implement only the current task.'],
            plan: context.plan,
            spec: context.spec,
            taskHandle,
            tasksSnippet: context.tasksSnippet,
            title:
              taskHandle === 'T001'
                ? 'Implement greeting'
                : 'Implement farewell',
          }),
        ]),
      ),
  })
  const git = new FakeGit(
    input?.changedFiles ?? [['src/greeting.ts'], ['src/farewell.ts']],
    input?.commitFailures ?? [],
  )
  const github = new FakeGitHub()
  const graph = createGraph()
  const taskSource = new InMemoryTaskSource(graph, workspace.prompts, workspace)
  return {
    git,
    workspace,
    runtime: {
      git,
      github,
      taskSource,
    },
  }
}
