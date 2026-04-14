import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { execa } from 'execa'

import { readSpecKitCompletionCriteriaFromPrompt } from './spec-kit-task-source-test-helpers'
import { createTaskPrompt } from './task-source-test-helpers'

import type { ReviewAgentInput } from '../src/agents/types'
import type { ReviewOutput, WorkspaceContext } from '../src/types'

export interface CreateWorkspaceInput {
  includeSecondTask?: boolean
  maxIterations?: number
}

export async function git(root: string, args: string[]) {
  const result = await execa('git', args, {
    cwd: root,
  })
  return result.stdout.trim()
}

export async function initGitRepo(root: string) {
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'While Test'])
  await git(root, ['config', 'user.email', 'while@example.com'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
}

export async function gitLogMessages(root: string) {
  const output = await git(root, ['log', '--format=%s'])
  return output.split('\n').filter(Boolean)
}

export async function currentHead(root: string) {
  return git(root, ['rev-parse', 'HEAD'])
}

export async function trackedFilesInHead(root: string) {
  const output = await git(root, ['show', '--name-only', '--format=', 'HEAD'])
  return output.split('\n').filter(Boolean)
}

export async function createWorkspace(input?: CreateWorkspaceInput) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-commands-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  const maxIterations = input?.maxIterations ?? 2
  const includeSecondTask = input?.includeSecondTask ?? true
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await writeFile(
    path.join(root, 'while.yaml'),
    [
      'task:',
      `  maxIterations: ${maxIterations}`,
      '  source: spec-kit',
      '',
      'workflow:',
      '  mode: direct',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '    reviewer:',
      '      provider: codex',
      '',
    ].join('\n'),
  )
  await writeFile(
    path.join(root, 'src', 'greeting.js'),
    'exports.buildGreeting = () => "broken"\n',
  )
  await writeFile(
    path.join(root, 'src', 'farewell.js'),
    'exports.buildFarewell = () => "broken"\n',
  )
  await writeFile(
    path.join(root, 'src', 'shared.js'),
    'exports.shared = "base"\n',
  )
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `
# Tasks

## Phase 1: Core

- [ ] T001 Implement greeting in src/greeting.js
${
  includeSecondTask
    ? `

- [ ] T002 Implement farewell in src/farewell.js
`
    : ''
}
`,
  )

  const context: WorkspaceContext = {
    featureDir,
    featureId: '001-demo',
    runtimeDir: path.join(featureDir, '.while'),
    workspaceRoot: root,
  }

  return { context, featureDir, root }
}

export function createPassingReview(input: ReviewAgentInput): ReviewOutput {
  const completionCriteria = readSpecKitCompletionCriteriaFromPrompt(
    input.prompt,
  )
  return {
    findings: [],
    overallRisk: 'low' as const,
    summary: 'ok',
    taskHandle: input.taskHandle,
    verdict: 'pass' as const,
    acceptanceChecks: completionCriteria.map((criterion) => ({
      criterion,
      note: 'ok',
      status: 'pass' as const,
    })),
  }
}

export { createTaskPrompt }
