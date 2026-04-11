import { describe, expect, test } from 'vitest'

import { TaskStatus } from '../src/harness/state'
import {
  action,
  branch,
  gate,
  sequence,
} from '../src/harness/workflow-builders'
import { WorkflowNodeType } from '../src/harness/workflow-program'

describe('workflow builders', () => {
  test('action creates an ActionNode with correct type', () => {
    const node = action('contract', {
      run: async () => ({ result: { kind: 'contract.generated' } }),
    })
    expect(node.name).toBe('contract')
    expect(node.type).toBe(WorkflowNodeType.Action)
  })

  test('action without run override uses default noop', () => {
    const node = action('contract')
    expect(node.run).toBeDefined()
  })

  test('gate creates a GateNode', () => {
    const node = gate('check_mode', {
      otherwise: 'integrate',
      then: 'review',
      test: async () => true,
    })
    expect(node.type).toBe(WorkflowNodeType.Gate)
    expect(node.then).toBe('review')
    expect(node.otherwise).toBe('integrate')
  })

  test('branch creates a BranchNode', () => {
    const node = branch('pick_path', {
      paths: { fast: 'integrate', slow: 'review' },
      decide: async () => 'fast',
    })
    expect(node.type).toBe(WorkflowNodeType.Branch)
    expect(node.paths).toStrictEqual({ fast: 'integrate', slow: 'review' })
  })

  test('sequence builds a WorkflowProgram with entry and nodes', () => {
    const program = sequence([action('a'), action('b')], {
      a: { 'a.done': { nextPhase: 'b', status: TaskStatus.Running } },
      b: { 'b.done': { nextPhase: null, status: TaskStatus.Done } },
    })
    expect(program.entry).toBe('a')
    expect(Object.keys(program.nodes)).toStrictEqual(['a', 'b'])
  })

  test('sequence validates transition keys reference existing nodes', () => {
    expect(() =>
      sequence([action('a')], {
        a: {
          'a.done': { nextPhase: 'nonexistent', status: TaskStatus.Running },
        },
      }),
    ).toThrow(/unknown node "nonexistent"/)
  })

  test('sequence validates transition table has entry for each action node', () => {
    expect(() =>
      sequence([action('a'), action('b')], {
        a: { 'a.done': { nextPhase: 'b', status: TaskStatus.Running } },
      }),
    ).toThrow(/missing transition table.*"b"/)
  })

  test('sequence allows gate and branch nodes without transition entries', () => {
    expect(() =>
      sequence(
        [
          action('a'),
          gate('g', { otherwise: 'a', then: 'a', test: async () => true }),
        ],
        {
          a: { 'a.done': { nextPhase: null, status: TaskStatus.Done } },
        },
      ),
    ).not.toThrow()
  })

  test('transition rule can be a function', () => {
    const program = sequence([action('a')], {
      a: {
        'a.retry': (input) =>
          input.state.iteration >= 3
            ? { nextPhase: null, status: TaskStatus.Blocked }
            : { nextPhase: 'a', status: TaskStatus.Running },
      },
    })
    expect(program.transitions.a!['a.retry']).toBeTypeOf('function')
  })
})
