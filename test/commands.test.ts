import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { beforeEach, expect, test, vi } from 'vitest'

import {
  createWorkspace,
  gitLogMessages,
  initGitRepo,
  trackedFilesInHead,
} from './command-test-helpers'

import type { RuntimePorts } from '../src/core/runtime'
import type { AgentInvocation, AgentPort } from '../src/ports/agent'
import type { ImplementOutput, ReviewOutput } from '../src/types'

function extractTaskHandle(prompt: string): string {
  const match = prompt.match(/Task Handle: (\S+)/)
  return match?.[1] ?? ''
}

function extractChangedFiles(prompt: string): string[] {
  const match = prompt.match(/Actual Changed Files:\n(.+)(?:\n\n|$)/)
  if (!match?.[1]) {
    return []
  }
  try {
    return JSON.parse(match[1]) as string[]
  } catch {
    return []
  }
}

interface ScriptedAgentContext {
  implementHandler: (taskHandle: string) => Promise<void>
  implementInputs: string[]
  reviewHandler: (
    taskHandle: string,
    changedFiles: string[],
  ) => Promise<ReviewOutput>
  reviewInputs: { actualChangedFiles: string[]; taskHandle: string }[]
}

function createScriptedAgentPort(ctx: ScriptedAgentContext): AgentPort {
  return {
    name: 'scripted',
    async execute(invocation: AgentInvocation): Promise<unknown> {
      const taskHandle = extractTaskHandle(invocation.prompt)
      if (invocation.role === 'implementer') {
        ctx.implementInputs.push(taskHandle)
        await ctx.implementHandler(taskHandle)
        const result: ImplementOutput = {
          assumptions: [],
          needsHumanAttention: false,
          notes: [],
          status: 'implemented',
          summary: `${taskHandle} done`,
          taskHandle,
          unresolvedItems: [],
        }
        return result
      }
      if (invocation.role === 'reviewer') {
        const changedFiles = extractChangedFiles(invocation.prompt)
        ctx.reviewInputs.push({ actualChangedFiles: changedFiles, taskHandle })
        return ctx.reviewHandler(taskHandle, changedFiles)
      }
      throw new Error(`Unknown role: ${invocation.role}`)
    },
  }
}

function createPassingReview(taskHandle: string): ReviewOutput {
  return {
    findings: [],
    overallRisk: 'low' as const,
    summary: 'ok',
    taskHandle,
    verdict: 'pass' as const,
    acceptanceChecks: [
      { criterion: 'basic', note: 'ok', status: 'pass' as const },
    ],
  }
}

const mockState = vi.hoisted(() => ({
  portOverrides: [] as ((real: RuntimePorts) => RuntimePorts)[],
}))

vi.mock('../src/core/create-runtime-ports', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/core/create-runtime-ports')>()
  return {
    ...original,
    createRuntimePorts: vi.fn(
      (...args: Parameters<typeof original.createRuntimePorts>) => {
        const real = original.createRuntimePorts(...args)
        const override = mockState.portOverrides.shift()
        if (!override) {
          return real
        }
        return override(real)
      },
    ),
  }
})

const { runCommand } = await import('../src/commands/run')

beforeEach(() => {
  mockState.portOverrides = []
})

function setupScriptedAgent(opts: {
  implementHandler: (taskHandle: string) => Promise<void>
  reviewHandler?: (
    taskHandle: string,
    changedFiles: string[],
  ) => Promise<ReviewOutput>
}) {
  const ctx: ScriptedAgentContext = {
    implementHandler: opts.implementHandler,
    implementInputs: [],
    reviewInputs: [],
    reviewHandler:
      opts.reviewHandler ??
      ((handle) => Promise.resolve(createPassingReview(handle))),
  }
  const agent = createScriptedAgentPort(ctx)
  mockState.portOverrides.push((real) => ({
    ...real,
    resolveAgent: () => agent,
  }))
  return ctx
}

test('runCommand creates one git commit per completed task without committing .while', async () => {
  const { context, root } = await createWorkspace()
  await initGitRepo(root)
  const ctx = setupScriptedAgent({
    async implementHandler(taskHandle) {
      if (taskHandle === 'T001') {
        await writeFile(
          path.join(root, 'src', 'greeting.js'),
          'exports.buildGreeting = () => "Hello, world!"\n',
        )
        return
      }
      await writeFile(
        path.join(root, 'src', 'farewell.js'),
        'exports.buildFarewell = () => "Bye, world!"\n',
      )
    },
  })

  const result = await runCommand(context)

  expect(result.summary.finalStatus).toBe('completed')
  expect(ctx.reviewInputs.map((input) => input.actualChangedFiles)).toEqual([
    ['src/greeting.js'],
    ['src/farewell.js'],
  ])

  const messages = await gitLogMessages(root)
  expect(messages.slice(0, 3)).toEqual([
    'Task T002: Implement farewell in src/farewell.js',
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])

  const headFiles = await trackedFilesInHead(root)
  expect(headFiles).toContain('src/farewell.js')
  expect(headFiles).toContain('specs/001-demo/tasks.md')
  expect(headFiles.some((file) => file.includes('.while'))).toBe(false)
})

test('runCommand rejects a dirty worktree before starting', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  await writeFile(path.join(root, 'draft.txt'), 'temporary\n')
  setupScriptedAgent({
    async implementHandler() {},
  })

  await expect(runCommand(context)).rejects.toThrow(/worktree.*clean/i)
})

test('runCommand keeps soft path boundaries and lets reviewer judge extra changed files', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  setupScriptedAgent({
    async implementHandler() {
      await writeFile(
        path.join(root, 'src', 'greeting.js'),
        'exports.buildGreeting = () => "Hello, world!"\n',
      )
      await writeFile(
        path.join(root, 'src', 'shared.js'),
        'exports.shared = "updated"\n',
      )
    },
    async reviewHandler(handle, changedFiles) {
      expect(changedFiles).toEqual(['src/greeting.js', 'src/shared.js'])
      return createPassingReview(handle)
    },
  })

  const result = await runCommand(context)

  expect(result.summary.finalStatus).toBe('completed')
})

test('runCommand reviews changed files before integrate', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  setupScriptedAgent({
    async implementHandler() {
      await writeFile(
        path.join(root, 'src', 'greeting.js'),
        'exports.buildGreeting = () => "Hello, world!"\n',
      )
    },
    async reviewHandler(handle, changedFiles) {
      expect(changedFiles).toEqual(['src/greeting.js'])
      return createPassingReview(handle)
    },
  })

  const result = await runCommand(context)

  expect(result.summary.finalStatus).toBe('completed')
})

test('runCommand resumes remaining tasks and keeps task-to-commit mapping linear', async () => {
  const { context, root } = await createWorkspace()
  await initGitRepo(root)
  const firstCtx = setupScriptedAgent({
    async implementHandler(taskHandle) {
      if (taskHandle === 'T001') {
        await writeFile(
          path.join(root, 'src', 'greeting.js'),
          'exports.buildGreeting = () => "Hello, world!"\n',
        )
      }
    },
  })

  const partial = await runCommand(context, {
    untilTaskId: 'T001',
  })
  const partialMessages = await gitLogMessages(root)

  expect(partial.summary.finalStatus).toBe('in_progress')
  expect(firstCtx.implementInputs).toEqual(['T001'])
  expect(partialMessages.slice(0, 2)).toEqual([
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])

  const secondCtx = setupScriptedAgent({
    async implementHandler() {
      await writeFile(
        path.join(root, 'src', 'farewell.js'),
        'exports.buildFarewell = () => "Bye, world!"\n',
      )
    },
  })

  const resumed = await runCommand(context)
  const resumedMessages = await gitLogMessages(root)

  expect(resumed.summary.completedTasks).toBe(2)
  expect(secondCtx.implementInputs).toEqual(['T002'])
  expect(resumedMessages.slice(0, 3)).toEqual([
    'Task T002: Implement farewell in src/farewell.js',
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])
})

test('runCommand reverts the tasks.md checkbox and blocks when the task commit fails', async () => {
  const { context, featureDir, root } = await createWorkspace({
    includeSecondTask: false,
    maxIterations: 1,
  })
  await initGitRepo(root)
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit')
  await writeFile(hookPath, '#!/bin/sh\nexit 1\n')
  await chmod(hookPath, 0o755)
  setupScriptedAgent({
    async implementHandler() {
      await writeFile(
        path.join(root, 'src', 'greeting.js'),
        'exports.buildGreeting = () => "Hello, world!"\n',
      )
    },
  })

  const result = await runCommand(context)
  const messages = await gitLogMessages(root)

  expect(result.summary.finalStatus).toBe('blocked')
  expect(messages[0]).toBe('Initial commit')

  const tasksMd = await readFile(path.join(featureDir, 'tasks.md'), 'utf8')
  expect(tasksMd).toMatch(/- \[ \] T001/)
})
