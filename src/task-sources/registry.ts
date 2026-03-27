import type { TaskSource } from './types'

const specKitTaskSource: TaskSource = {
  name: 'spec-kit',
  async open() {
    throw new Error('spec-kit task source is not implemented yet')
  },
}

export function getTaskSource(name: string): TaskSource {
  if (name === 'spec-kit') {
    return specKitTaskSource
  }

  throw new Error(`Unknown task source: ${name}`)
}
