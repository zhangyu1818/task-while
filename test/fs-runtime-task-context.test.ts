import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { createOrchestratorRuntime } from '../src/runtime/fs-runtime'

async function createFeatureWorkspace() {
  const root = await mkdtemp(
    path.join(tmpdir(), 'while-orchestrator-runtime-context-'),
  )
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'greeting.ts'),
    'export const greeting = "hi"\n',
  )
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `
# Tasks

## Phase 1: Core

- [ ] T001 Implement greeting
  - Depends: T002
  - Acceptance:
    - works
  - Review Rubric:
    - clear
  - Max Iterations: 1

- [ ] T002 Implement follow-up
  - Depends:
  - Acceptance:
    - works
  - Review Rubric:
    - clear
  - Max Iterations: 1
`,
  )
  return { featureDir, root }
}

test('OrchestratorRuntime task snippet starts from the matching task header instead of dependency lines', async () => {
  const { featureDir, root } = await createFeatureWorkspace()

  const runtime = createOrchestratorRuntime({
    featureDir,
    workspaceRoot: root,
  })
  const context = await runtime.workspace.loadTaskContext({
    id: 'T002',
    acceptance: ['works'],
    dependsOn: [],
    maxAttempts: 1,
    parallelizable: false,
    phase: 'Core',
    reviewRubric: ['clear'],
    title: 'Implement follow-up',
  })

  expect(context.tasksSnippet.trimStart()).toMatch(
    /^- \[ \] T002 Implement follow-up/m,
  )
  expect(context.tasksSnippet).not.toContain('- Depends: T002')
})

test('OrchestratorRuntime task context rejects missing spec.md', async () => {
  const { featureDir, root } = await createFeatureWorkspace()
  await rm(path.join(featureDir, 'spec.md'))

  const runtime = createOrchestratorRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await expect(
    runtime.workspace.loadTaskContext({
      id: 'T002',
      acceptance: ['works'],
      dependsOn: [],
      maxAttempts: 1,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Implement follow-up',
    }),
  ).rejects.toThrow(/spec\.md/i)
})

test('OrchestratorRuntime task context allows empty spec.md', async () => {
  const { featureDir, root } = await createFeatureWorkspace()
  await writeFile(path.join(featureDir, 'spec.md'), '')

  const runtime = createOrchestratorRuntime({
    featureDir,
    workspaceRoot: root,
  })

  const context = await runtime.workspace.loadTaskContext({
    id: 'T002',
    acceptance: ['works'],
    dependsOn: [],
    maxAttempts: 1,
    parallelizable: false,
    phase: 'Core',
    reviewRubric: ['clear'],
    title: 'Implement follow-up',
  })

  expect(context.spec).toBe('')
})
