import { expect, test } from 'vitest'

import { createWhileE2eArgs } from '../fixtures/smoke/codex-e2e'

test('createWhileE2eArgs only passes --verbose to run', () => {
  expect(
    createWhileE2eArgs({
      command: 'run',
      workspaceRoot: '/tmp/workspace',
    }),
  ).toContain('--verbose')

  expect(
    createWhileE2eArgs({
      command: 'rewind',
      taskId: 'T001',
      workspaceRoot: '/tmp/workspace',
    }),
  ).not.toContain('--verbose')
})
