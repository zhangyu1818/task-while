import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { AgentInvocation, AgentPort } from '../src/ports/agent'

const agentState = vi.hoisted(() => ({
  agent: null as AgentPort | null,
  invocations: [] as AgentInvocation[],
  createAgentPort: vi.fn(() => {
    if (!agentState.agent) {
      throw new Error('Missing batch agent')
    }
    return agentState.agent
  }),
}))

vi.mock('../src/ports/agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ports/agent')>()
  return {
    ...original,
    createAgentPort: agentState.createAgentPort,
  }
})

const { runBatchCommand } = await import('../src/commands/batch')

const workspaces: string[] = []

function extractFilePath(prompt: string) {
  const match = prompt.match(/File path: (.+)(?:\n|$)/)
  return match?.[1] ?? ''
}

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-command-'))
  workspaces.push(root)
  return root
}

async function writeConfig(root: string) {
  const configPath = path.join(root, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      'glob:',
      '  - "input/*.txt"',
      'prompt: |',
      '  summarize file',
      'schema:',
      '  type: object',
      '  properties:',
      '    summary:',
      '      type: string',
      '  required:',
      '    - summary',
      '',
    ].join('\n'),
  )
  return configPath
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

beforeEach(() => {
  agentState.agent = null
  agentState.createAgentPort.mockClear()
  agentState.invocations = []
})

test('runBatchCommand retries files that throw and eventually succeeds', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  let attemptCount = 0

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      attemptCount += 1
      if (attemptCount === 1) {
        throw new Error('transient error')
      }
      return {
        summary: extractFilePath(invocation.prompt),
      }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(agentState.invocations).toHaveLength(2)
  expect(result.processedFiles).toEqual(['input/a.txt'])
  expect(result.failedFiles).toEqual([])
})

test('runBatchCommand blocks files that permanently fail after max retries', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      throw new Error('permanent error')
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(agentState.invocations).toHaveLength(3)
  expect(result.processedFiles).toEqual([])
  expect(result.failedFiles).toEqual(['input/a.txt'])
})
