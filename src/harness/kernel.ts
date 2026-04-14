import {
  createInitialState,
  TaskStatus,
  type Artifact,
  type TaskState,
} from './state'

import type { HarnessStore } from './store'
import type {
  DomainResult,
  Transition,
  TransitionRule,
  TypedArtifactMap,
  WorkflowContext,
  WorkflowProgram,
} from './workflow-program'

export enum KernelResultKind {
  Error = 'error',
}

export function retryBudgetReached(state: TaskState, maxIterations: number) {
  return Math.max(0, ...Object.values(state.phaseIterations)) >= maxIterations
}

export function errorRetry(maxIterations: number) {
  return (retryPhase: string): TransitionRule =>
    (input) =>
      retryBudgetReached(input.state, maxIterations)
        ? { nextPhase: null, status: TaskStatus.Blocked }
        : { nextPhase: retryPhase, status: TaskStatus.Running }
}

export interface KernelResult {
  status: TaskStatus
}

export async function runKernel(input: {
  config: Record<string, unknown>
  program: WorkflowProgram
  protocol: string
  store: HarnessStore
  subjectId: string
}): Promise<KernelResult> {
  const { config, program, protocol, store, subjectId } = input

  let state =
    (await store.loadState(protocol, subjectId)) ?? createInitialState()

  if (
    state.status === TaskStatus.Done ||
    state.status === TaskStatus.Blocked ||
    state.status === TaskStatus.Replan
  ) {
    return { status: state.status }
  }

  const artifactCache = new Map<string, Artifact>()
  for (const [kind, artifactId] of Object.entries(state.artifacts)) {
    const artifact = await store.loadArtifact(protocol, subjectId, artifactId)
    if (artifact) {
      artifactCache.set(kind, artifact)
    }
  }

  const artifacts: TypedArtifactMap = {
    get<T>(kind: string) {
      return artifactCache.get(kind) as Artifact<T> | undefined
    },
    has(kind: string) {
      return artifactCache.has(kind)
    },
    set(artifact: Artifact) {
      artifactCache.set(artifact.kind, artifact)
    },
  }

  if (state.status === TaskStatus.Suspended) {
    state = { ...state, status: TaskStatus.Running }
    await store.saveState(protocol, subjectId, state)
  }

  let current: null | string = state.currentPhase ?? program.entry

  while (current) {
    const node = program.nodes[current]
    if (!node) {
      throw new Error(`unknown node: ${current}`)
    }

    const phaseCount = (state.phaseIterations[current] ?? 0) + 1
    state = {
      ...state,
      currentPhase: current,
      iteration: phaseCount,
      phaseIterations: { ...state.phaseIterations, [current]: phaseCount },
      status: TaskStatus.Running,
    }
    await store.saveState(protocol, subjectId, state)

    let actionResult: { artifact?: Artifact; result: DomainResult }
    try {
      const ctx: WorkflowContext = { artifacts, config, state, subjectId }
      actionResult = await node.run(ctx)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      state = { ...state, failureReason: reason }

      if (program.transitions[current]?.[KernelResultKind.Error]) {
        actionResult = { result: { kind: KernelResultKind.Error } }
      } else {
        state = { ...state, status: TaskStatus.Blocked }
        await store.saveState(protocol, subjectId, state)
        await store.appendTransition(protocol, subjectId, {
          nextPhase: null,
          phase: current,
          resultKind: KernelResultKind.Error,
          status: TaskStatus.Blocked,
          timestamp: new Date().toISOString(),
        })
        return { status: TaskStatus.Blocked }
      }
    }

    if (actionResult.artifact) {
      await store.saveArtifact(protocol, subjectId, actionResult.artifact)
      artifacts.set(actionResult.artifact)
      state = {
        ...state,
        artifacts: {
          ...state.artifacts,
          [actionResult.artifact.kind]: actionResult.artifact.id,
        },
      }
    }

    const transitionTable = program.transitions[current]
    if (!transitionTable) {
      throw new Error(`no transition table for "${current}"`)
    }

    const rule: TransitionRule | undefined =
      transitionTable[actionResult.result.kind]
    if (!rule) {
      throw new Error(
        `no transition rule for "${current}" -> "${actionResult.result.kind}"`,
      )
    }

    const transition: Transition =
      typeof rule === 'function'
        ? rule({ result: actionResult.result, state })
        : rule

    state = {
      ...state,
      currentPhase: transition.nextPhase,
      status: transition.status,
      completedAt:
        transition.status === TaskStatus.Done
          ? new Date().toISOString()
          : state.completedAt,
    }
    await store.saveState(protocol, subjectId, state)

    await store.appendTransition(protocol, subjectId, {
      nextPhase: transition.nextPhase,
      phase: current,
      resultKind: actionResult.result.kind,
      status: transition.status,
      timestamp: new Date().toISOString(),
    })

    if (state.status !== TaskStatus.Running) {
      return { status: state.status }
    }

    current = transition.nextPhase
  }

  return { status: state.status }
}
