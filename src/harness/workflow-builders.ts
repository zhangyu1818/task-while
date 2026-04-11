import {
  WorkflowNodeType,
  type ActionNode,
  type ActionRunFn,
  type BranchDecideFn,
  type BranchNode,
  type GateNode,
  type GateTestFn,
  type TransitionRule,
  type WorkflowNode,
  type WorkflowProgram,
} from './workflow-program'

export function action<TConfig = unknown>(
  name: string,
  overrides?: { run?: ActionRunFn<TConfig> },
): ActionNode<TConfig> {
  return {
    name,
    type: WorkflowNodeType.Action,
    run:
      overrides?.run ??
      (async () => ({ result: { kind: `${name}.completed` } })),
  }
}

export function gate<TConfig = unknown>(
  name: string,
  input: { otherwise: string; test: GateTestFn<TConfig>; then: string },
): GateNode<TConfig> {
  return {
    name,
    otherwise: input.otherwise,
    test: input.test,
    then: input.then,
    type: WorkflowNodeType.Gate,
  }
}

export function branch<TConfig = unknown>(
  name: string,
  input: { decide: BranchDecideFn<TConfig>; paths: Record<string, string> },
): BranchNode<TConfig> {
  return {
    name,
    decide: input.decide,
    paths: input.paths,
    type: WorkflowNodeType.Branch,
  }
}

export function sequence<TConfig = unknown>(
  nodes: WorkflowNode<TConfig>[],
  transitions: Record<string, Record<string, TransitionRule>>,
): WorkflowProgram<TConfig> {
  const nodeMap: Record<string, WorkflowNode<TConfig>> = {}
  for (const node of nodes) {
    nodeMap[node.name] = node
  }

  const nodeNames = new Set(Object.keys(nodeMap))

  for (const node of nodes) {
    if (node.type === WorkflowNodeType.Action && !(node.name in transitions)) {
      throw new Error(`missing transition table for action node "${node.name}"`)
    }
  }

  for (const rules of Object.values(transitions)) {
    for (const rule of Object.values(rules)) {
      if (typeof rule === 'function') {
        continue
      }
      if (rule.nextPhase !== null && !nodeNames.has(rule.nextPhase)) {
        throw new Error(
          `transition references unknown node "${rule.nextPhase}"`,
        )
      }
    }
  }

  return {
    entry: nodes[0]!.name,
    nodes: nodeMap,
    transitions,
  }
}
