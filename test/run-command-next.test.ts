import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import {
  createWorkspace,
  gitLogMessages,
  initGitRepo,
} from './command-test-helpers'

import type { RuntimePorts } from '../src/core/runtime'
import type { AgentInvocation, AgentPort } from '../src/ports/agent'
import type { ImplementOutput, ReviewOutput } from '../src/types'

function extractTaskHandle(prompt: string): string {
  const match = prompt.match(/Task Handle: (\S+)/)
  return match?.[1] ?? ''
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

function createNoopAgent(): AgentPort {
  return {
    name: 'noop',
    async execute(invocation: AgentInvocation): Promise<unknown> {
      const taskHandle = extractTaskHandle(invocation.prompt)
      if (invocation.role === 'implementer') {
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
      return createPassingReview(taskHandle)
    },
  }
}

describe('run command v.next wiring', () => {
  test('runCommand function exists with correct signature', () => {
    expect(typeof runCommand).toBe('function')
  })

  test('runCommand returns expected result shape', async () => {
    const { context, root } = await createWorkspace({
      includeSecondTask: false,
    })
    await initGitRepo(root)

    const agent = createNoopAgent()
    mockState.portOverrides.push((real) => ({
      ...real,
      resolveAgent: () => agent,
    }))

    const result = await runCommand(context)

    expect(result).toHaveProperty('summary')
    expect(result.summary).toHaveProperty('blockedTasks')
    expect(result.summary).toHaveProperty('completedTasks')
    expect(result.summary).toHaveProperty('finalStatus')
    expect(result.summary).toHaveProperty('replanTasks')
    expect(result.summary).toHaveProperty('totalTasks')
  })

  test('--until-task returns in_progress when target is done but others remain', async () => {
    const { context, root } = await createWorkspace()
    await initGitRepo(root)

    const agent: AgentPort = {
      name: 'noop',
      async execute(invocation: AgentInvocation): Promise<unknown> {
        const taskHandle = extractTaskHandle(invocation.prompt)
        if (invocation.role === 'implementer') {
          if (taskHandle === 'T001') {
            await writeFile(
              path.join(root, 'src', 'greeting.js'),
              'exports.buildGreeting = () => "Hello, world!"\n',
            )
          }
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
        return createPassingReview(taskHandle)
      },
    }

    mockState.portOverrides.push((real) => ({
      ...real,
      resolveAgent: () => agent,
    }))

    const result = await runCommand(context, { untilTaskId: 'T001' })

    expect(result.summary.finalStatus).toBe('in_progress')
    expect(result.summary.completedTasks).toBe(1)

    const messages = await gitLogMessages(root)
    expect(messages[0]).toBe('Task T001: Implement greeting in src/greeting.js')
  })

  test('session + kernel stack completes a single task end to end', async () => {
    const { context, root } = await createWorkspace({
      includeSecondTask: false,
    })
    await initGitRepo(root)

    const agent: AgentPort = {
      name: 'noop',
      async execute(invocation: AgentInvocation): Promise<unknown> {
        const taskHandle = extractTaskHandle(invocation.prompt)
        if (invocation.role === 'implementer') {
          await writeFile(
            path.join(root, 'src', 'greeting.js'),
            'exports.buildGreeting = () => "Hello!"\n',
          )
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
        return createPassingReview(taskHandle)
      },
    }

    mockState.portOverrides.push((real) => ({
      ...real,
      resolveAgent: () => agent,
    }))

    const result = await runCommand(context)

    expect(result.summary.finalStatus).toBe('completed')
    expect(result.summary.completedTasks).toBe(1)
    expect(result.summary.totalTasks).toBe(1)
  })
})
