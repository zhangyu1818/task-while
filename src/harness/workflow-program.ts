import type { Artifact, TaskState, TaskStatus } from './state'

export enum WorkflowNodeType {
  Action = 'action',
  Branch = 'branch',
  Gate = 'gate',
}

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

export type GateTestFn<TConfig = unknown> = (
  ctx: WorkflowContext<TConfig>,
) => Promise<boolean>

export type BranchDecideFn<TConfig = unknown> = (
  ctx: WorkflowContext<TConfig>,
) => Promise<string>

export interface ActionNode<TConfig = unknown> {
  name: string
  run: ActionRunFn<TConfig>
  type: WorkflowNodeType.Action
}

export interface GateNode<TConfig = unknown> {
  name: string
  otherwise: string
  test: GateTestFn<TConfig>
  then: string
  type: WorkflowNodeType.Gate
}

export interface BranchNode<TConfig = unknown> {
  decide: BranchDecideFn<TConfig>
  name: string
  paths: Record<string, string>
  type: WorkflowNodeType.Branch
}

export type WorkflowNode<TConfig = unknown> =
  | ActionNode<TConfig>
  | BranchNode<TConfig>
  | GateNode<TConfig>

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
