import { expect, test } from 'vitest'

import { buildTaskTopology } from '../src/core/task-topology'

import type { TaskSourceSession } from '../src/task-sources/types'

function createBrokenSession(
  mode: 'cycle' | 'duplicate-handle' | 'unknown-dependency',
): TaskSourceSession {
  const handles =
    mode === 'duplicate-handle'
      ? ['task/greet', 'task/greet']
      : ['task/greet', 'task/farewell']

  return {
    async applyTaskCompletion() {},
    buildCommitSubject(taskHandle) {
      return `Task ${taskHandle}`
    },
    async buildImplementPrompt() {
      return { instructions: [], sections: [] }
    },
    async buildReviewPrompt() {
      return { instructions: [], sections: [] }
    },
    async getCompletionCriteria() {
      return []
    },
    getTaskDependencies(taskHandle) {
      if (mode === 'unknown-dependency' && taskHandle === 'task/farewell') {
        return ['task/missing']
      }
      if (mode === 'cycle') {
        return taskHandle === 'task/greet' ? ['task/farewell'] : ['task/greet']
      }
      return []
    },
    async isTaskCompleted() {
      return false
    },
    listTasks() {
      return handles
    },
    resolveTaskSelector(selector) {
      return selector
    },
    async revertTaskCompletion() {},
  }
}

test('buildTaskTopology rejects duplicate handles unknown dependencies and cycles', () => {
  expect(() =>
    buildTaskTopology(createBrokenSession('duplicate-handle'), '001-demo', 5),
  ).toThrow(/duplicate task handle/i)
  expect(() =>
    buildTaskTopology(createBrokenSession('unknown-dependency'), '001-demo', 5),
  ).toThrow(/unknown dependency/i)
  expect(() =>
    buildTaskTopology(createBrokenSession('cycle'), '001-demo', 5),
  ).toThrow(/dependency cycle/i)
})
