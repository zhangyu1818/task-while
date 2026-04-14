import type { Artifact, TaskState, TaskStatus } from './state'

export interface TypedArtifactMap {
  get: <T = unknown>(kind: string) => Artifact<T> | undefined
  has: (kind: string) => boolean
  set: (artifact: Artifact) => void
}

export interface WorkflowContext<TConfig = unknown> {
  artifacts: TypedArtifactMap
  config: TConfig
  state: TaskState
  subjectId: string
}

export interface DomainResult<
  TKind extends string = string,
  TPayload = unknown,
> {
  kind: TKind
  payload?: TPayload
}

export interface ActionResult {
  artifact?: Artifact
  result: DomainResult
}

export type ActionRunFn<TConfig = unknown> = (
  ctx: WorkflowContext<TConfig>,
) => Promise<ActionResult>

export interface ActionNode<TConfig = unknown> {
  name: string
  run: ActionRunFn<TConfig>
}

export type WorkflowNode<TConfig = unknown> = ActionNode<TConfig>

export interface Transition {
  nextPhase: null | string
  status: TaskStatus
}

export type TransitionRule =
  | ((input: { result: DomainResult; state: TaskState }) => Transition)
  | Transition

export interface WorkflowProgram<TConfig = unknown> {
  entry: string
  nodes: Record<string, WorkflowNode<TConfig>>
  transitions: Record<string, Record<string, TransitionRule>>
}

export function createWorkflowProgram<TConfig = unknown>(
  nodes: WorkflowNode<TConfig>[],
  transitions: Record<string, Record<string, TransitionRule>>,
): WorkflowProgram<TConfig> {
  if (nodes.length === 0) {
    throw new Error('workflow program requires at least one node')
  }

  const nodeMap: Record<string, WorkflowNode<TConfig>> = {}
  for (const node of nodes) {
    if (node.name in nodeMap) {
      throw new Error(`duplicate node "${node.name}"`)
    }
    nodeMap[node.name] = node
  }

  const nodeNames = new Set(Object.keys(nodeMap))

  for (const node of nodes) {
    if (!(node.name in transitions)) {
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
