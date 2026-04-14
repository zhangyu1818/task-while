import { openspecTaskSource } from './openspec/source'
import { specKitTaskSource } from './spec-kit/source'

import type { OpenTaskSourceInput, TaskSource, TaskSourceName } from './types'

const taskSources: Record<TaskSourceName, TaskSource> = {
  openspec: openspecTaskSource,
  'spec-kit': specKitTaskSource,
}

export async function openTaskSource(
  name: TaskSourceName,
  input: OpenTaskSourceInput,
) {
  return taskSources[name].open(input)
}
