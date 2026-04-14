import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-error-'))
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

test('runBatchCommand blocks files with broken symlinks (prepare errors)', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await symlink(
    path.join(inputDir, 'nonexistent'),
    path.join(inputDir, 'a.txt'),
  )
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  agentState.agent = {
    name: 'codex',
    async execute(invocation) {
      agentState.invocations.push(invocation)
      return { summary: extractFilePath(invocation.prompt) }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(result.processedFiles).toContain('input/b.txt')
  expect(result.failedFiles).toContain('input/a.txt')
  expect(result.results).toHaveProperty('input/b.txt')
  expect(result.results).not.toHaveProperty('input/a.txt')
})
