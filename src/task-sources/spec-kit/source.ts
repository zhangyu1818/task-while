import path from 'node:path'

import * as fsExtra from 'fs-extra'

import { parseTasksMd } from './parse-tasks-md'
import { createSpecKitSession } from './session'

import type { OpenTaskSourceInput, TaskSource } from '../types'

async function assertRequiredFeatureFiles(featureDir: string) {
  for (const fileName of ['spec.md', 'plan.md', 'tasks.md']) {
    const filePath = path.join(featureDir, fileName)
    const fileExists = await fsExtra.pathExists(filePath)
    if (!fileExists) {
      throw new Error(`Missing required feature file: ${filePath}`)
    }
  }
}

export const specKitTaskSource: TaskSource = {
  name: 'spec-kit',
  async open(input: OpenTaskSourceInput) {
    await assertRequiredFeatureFiles(input.featureDir)
    const tasks = await parseTasksMd(path.join(input.featureDir, 'tasks.md'))
    return createSpecKitSession({
      ...input,
      tasks,
    })
  },
}
