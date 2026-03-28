import { readFile } from 'node:fs/promises'

export interface SpecKitTask {
  id: string
  phase: string
  rawLine: string
  title: string
}

function createTask(line: string, phase: string): SpecKitTask {
  const match = line.match(
    /^- \[[ xX]\] (T\d{3,})(?: \[P\])?(?: \[[A-Z]{2,}\d+\])? (.+)$/,
  )
  if (!match) {
    throw new Error(`Invalid task line: ${line}`)
  }
  return {
    id: match[1]!,
    phase,
    rawLine: line,
    title: match[2]!,
  }
}

export async function parseTasksMd(tasksPath: string): Promise<SpecKitTask[]> {
  const content = await readFile(tasksPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const tasks: SpecKitTask[] = []
  let currentPhase = 'unknown'

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('## ')) {
      currentPhase = line.replace(/^##\s+/, '').trim()
      continue
    }

    if (line.startsWith('- [') && line.includes(' T')) {
      tasks.push(createTask(line, currentPhase))
    }
  }

  if (tasks.length === 0) {
    throw new Error('No tasks found in tasks.md')
  }

  return tasks
}
