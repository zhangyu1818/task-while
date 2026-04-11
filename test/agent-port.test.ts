import { describe, expect, test, vi } from 'vitest'

import { createRoleInvocation, type AgentPort } from '../src/ports/agent'

describe('agent port', () => {
  test('createRoleInvocation attaches role to invocation', () => {
    const invocation = createRoleInvocation('implementer', {
      outputSchema: { type: 'object' },
      prompt: 'implement this',
    })
    expect(invocation.role).toBe('implementer')
    expect(invocation.prompt).toBe('implement this')
  })

  test('agent port execute is callable with any role invocation', async () => {
    const agent: AgentPort = {
      name: 'test-agent',
      execute: vi.fn(async () => ({ status: 'ok' })),
    }

    const impl = createRoleInvocation('implementer', {
      outputSchema: {},
      prompt: 'do it',
    })
    const rev = createRoleInvocation('reviewer', {
      outputSchema: {},
      prompt: 'review it',
    })

    await agent.execute(impl)
    await agent.execute(rev)

    expect(agent.execute).toHaveBeenCalledTimes(2)
  })
})
