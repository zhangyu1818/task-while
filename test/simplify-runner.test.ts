import { expect, test } from 'vitest'

import { runSimplify } from '../src/simplify/runner'

import type { SimplifyConfig } from '../src/simplify/config'

function createConfig(overrides?: Partial<SimplifyConfig>): SimplifyConfig {
  return {
    configDir: '/tmp/test',
    configPath: '/tmp/test/simplify.yaml',
    exclude: [],
    prompt: 'simplify {{turn}}',
    provider: 'chatgpt',
    turns: 3,
    ...overrides,
  }
}

test('runSimplify calls runTurn for each turn with replaced prompt', async () => {
  const calls: { prompt: string; turn: number }[] = []

  await runSimplify({
    config: createConfig({ turns: 3 }),
    cwd: '/tmp/test',
    async runTurn(options) {
      calls.push({ prompt: options.prompt, turn: options.turn })
    },
  })

  expect(calls).toEqual([
    { prompt: 'simplify 1', turn: 1 },
    { prompt: 'simplify 2', turn: 2 },
    { prompt: 'simplify 3', turn: 3 },
  ])
})

test('runSimplify returns completed and total turns', async () => {
  const result = await runSimplify({
    config: createConfig({ turns: 2 }),
    cwd: '/tmp/test',
    async runTurn() {},
  })

  expect(result).toEqual({ completedTurns: 2, totalTurns: 2 })
})

test('runSimplify propagates runTurn errors', async () => {
  await expect(
    runSimplify({
      config: createConfig({ turns: 3 }),
      cwd: '/tmp/test',
      async runTurn(options) {
        if (options.turn === 2) {
          throw new Error('turn 2 failed')
        }
      },
    }),
  ).rejects.toThrow('turn 2 failed')
})

test('runSimplify passes exclude and configPath to runTurn', async () => {
  const calls: { configPath: string; exclude: string[] }[] = []

  await runSimplify({
    cwd: '/tmp/test',
    config: createConfig({
      configPath: '/tmp/test/my.yaml',
      exclude: ['dist/**'],
      turns: 1,
    }),
    async runTurn(options) {
      calls.push({ configPath: options.configPath, exclude: options.exclude })
    },
  })

  expect(calls).toEqual([
    { configPath: '/tmp/test/my.yaml', exclude: ['dist/**'] },
  ])
})
