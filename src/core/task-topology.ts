import type { TaskSourceSession } from '../task-sources/types'

export interface TaskTopologyEntry {
  commitSubject: string
  dependsOn: string[]
  handle: string
}

export interface TaskTopology {
  featureId: string
  maxIterations: number
  tasks: TaskTopologyEntry[]
}

function ensureUniqueHandles(handles: string[]) {
  const seen = new Set<string>()
  for (const handle of handles) {
    if (seen.has(handle)) {
      throw new Error(`Duplicate task handle: ${handle}`)
    }
    seen.add(handle)
  }
}

function ensureDependenciesExist(tasks: TaskTopologyEntry[]) {
  const handles = new Set(tasks.map((task) => task.handle))
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!handles.has(dependency)) {
        throw new Error(
          `Unknown dependency: ${dependency} for task ${task.handle}`,
        )
      }
    }
  }
}

function ensureAcyclic(tasks: TaskTopologyEntry[]) {
  const graph = new Map(tasks.map((task) => [task.handle, task.dependsOn]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (handle: string) => {
    if (visiting.has(handle)) {
      throw new Error(`Dependency cycle detected at ${handle}`)
    }
    if (visited.has(handle)) {
      return
    }
    visiting.add(handle)
    for (const dependency of graph.get(handle) ?? []) {
      visit(dependency)
    }
    visiting.delete(handle)
    visited.add(handle)
  }

  for (const task of tasks) {
    visit(task.handle)
  }
}

export function buildTaskTopology(
  session: TaskSourceSession,
  featureId: string,
  maxIterations: number,
): TaskTopology {
  const handles = session.listTasks()
  ensureUniqueHandles(handles)

  const tasks = handles.map((handle) => ({
    commitSubject: session.buildCommitSubject(handle),
    dependsOn: session.getTaskDependencies(handle),
    handle,
  }))

  ensureDependenciesExist(tasks)
  ensureAcyclic(tasks)

  return {
    featureId,
    maxIterations,
    tasks,
  }
}
