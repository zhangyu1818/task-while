import type { Artifact, TaskState, TransitionRecord } from './state'
import type { HarnessStore } from './store'

const storeKey = (protocol: string, subjectId: string) =>
  `${protocol}:${subjectId}`

export function createInMemoryHarnessStore(): HarnessStore {
  const states = new Map<string, TaskState>()
  const artifacts = new Map<string, Artifact>()
  const transitions = new Map<string, TransitionRecord[]>()

  return {
    async appendTransition(protocol, subjectId, record) {
      const k = storeKey(protocol, subjectId)
      const list = transitions.get(k) ?? []
      list.push(structuredClone(record))
      transitions.set(k, list)
    },
    async listArtifacts(protocol, subjectId) {
      const prefix = `${storeKey(protocol, subjectId)}:`
      return [...artifacts.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => structuredClone(v))
    },
    async loadArtifact(protocol, subjectId, artifactId) {
      const artifact = artifacts.get(
        `${storeKey(protocol, subjectId)}:${artifactId}`,
      )
      return artifact ? structuredClone(artifact) : null
    },
    async loadState(protocol, subjectId) {
      const state = states.get(storeKey(protocol, subjectId))
      return state ? structuredClone(state) : null
    },
    async saveArtifact(protocol, subjectId, artifact) {
      artifacts.set(
        `${storeKey(protocol, subjectId)}:${artifact.id}`,
        structuredClone(artifact),
      )
    },
    async saveState(protocol, subjectId, state) {
      states.set(storeKey(protocol, subjectId), structuredClone(state))
    },
  }
}
