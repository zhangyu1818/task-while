export enum TaskStatus {
  Blocked = 'blocked',
  Done = 'done',
  Queued = 'queued',
  Replan = 'replan',
  Running = 'running',
  Suspended = 'suspended',
}

export interface TaskState {
  artifacts: Record<string, string>
  completedAt: null | string
  currentPhase: null | string
  failureReason: null | string
  iteration: number
  phaseIterations: Record<string, number>
  status: TaskStatus
}

export interface TransitionRecord {
  nextPhase: null | string
  phase: string
  resultKind: string
  status: TaskStatus
  timestamp: string
}

export interface Artifact<TPayload = unknown> {
  id: string
  kind: string
  payload: TPayload
  subjectId: string
  timestamp: string
}

export function createInitialState(): TaskState {
  return {
    artifacts: {},
    completedAt: null,
    currentPhase: null,
    failureReason: null,
    iteration: 0,
    phaseIterations: {},
    status: TaskStatus.Queued,
  }
}
