import { afterEach, beforeEach, expect, test, vi } from 'vitest'

interface RewindCall {
  context: unknown
  taskHandle: string
}

const mockState = vi.hoisted(() => {
  return {
    resolveCalls: [] as unknown[],
    rewindCalls: [] as RewindCall[],
    runCalls: [] as unknown[],
  }
})

vi.mock('../src/runtime/workspace-resolver', () => {
  return {
    resolveWorkspaceContext: vi.fn(async (input) => {
      mockState.resolveCalls.push(input)
      return {
        featureDir: '/tmp/specs/001-demo',
        featureId: '001-demo',
        runtimeDir: '/tmp/specs/001-demo/.while',
        workspaceRoot: '/tmp/workspace',
      }
    }),
  }
})

vi.mock('../src/commands/run', () => {
  return {
    runCommand: vi.fn(async (context, options) => {
      mockState.runCalls.push({ context, options })
      return { ok: true }
    }),
  }
})

vi.mock('../src/commands/rewind', () => {
  return {
    rewindCommand: vi.fn(async (context, taskHandle) => {
      mockState.rewindCalls.push({ context, taskHandle })
      return { rewound: taskHandle }
    }),
  }
})

const { handleFatalError, runCli } = await import('../src/index')

beforeEach(() => {
  mockState.rewindCalls = []
  mockState.resolveCalls = []
  mockState.runCalls = []
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

test('runCli dispatches run command and prints result', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/current')

  await runCli([
    'run',
    '--feature',
    '001-demo',
    '--until-task',
    'T002',
    '--verbose',
  ])

  expect(mockState.resolveCalls).toEqual([
    {
      cwd: '/tmp/current',
      feature: '001-demo',
    },
  ])
  expect(mockState.runCalls[0]).toMatchObject({
    options: {
      untilTaskId: 'T002',
      verbose: true,
    },
  })
  expect(stdout).toHaveBeenCalledWith('{ ok: true }\n')
  cwd.mockRestore()
})

test('runCli rejects removed workspace flag and unexpected positional arguments', async () => {
  const removedWorkspaceFlag = ['--', 'workspace'].join('')

  await expect(
    runCli([
      'run',
      removedWorkspaceFlag,
      '/tmp/workspace',
      '--feature',
      '001-demo',
    ]),
  ).rejects.toThrow(/unknown|unexpected option/i)
  await expect(
    runCli([
      'rewind',
      removedWorkspaceFlag,
      '/tmp/workspace',
      '--task',
      'T001',
    ]),
  ).rejects.toThrow(/unknown|unexpected option/i)
  await expect(
    runCli(['rewind', '--feature', '001-demo', '--task', 'T001', 'extra']),
  ).rejects.toThrow(/Unexpected positional arguments: extra/)
})

test('runCli dispatches rewind command and requires task id', async () => {
  await runCli(['rewind', '--feature', '001-demo', '--task', 'T001'])

  expect(mockState.rewindCalls[0]).toMatchObject({
    taskHandle: 'T001',
  })

  await expect(runCli(['rewind'])).rejects.toThrow(/Missing --task/)
})

test('runCli rejects removed resume command and unknown commands', async () => {
  await expect(runCli(['resume'])).rejects.toThrow(/Unknown command: resume/)
  await expect(runCli(['wat'])).rejects.toThrow(/Unknown command: wat/)
})

test('handleFatalError writes message to stderr and sets exitCode', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

  handleFatalError(new Error('boom'))

  expect(stderr).toHaveBeenCalledWith('boom\n')
  expect(process.exitCode).toBe(1)
})
