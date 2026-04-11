import type { Artifact, TaskState, TransitionRecord } from './state'

export interface HarnessStore {
  appendTransition: (
    protocol: string,
    subjectId: string,
    record: TransitionRecord,
  ) => Promise<void>
  listArtifacts: (protocol: string, subjectId: string) => Promise<Artifact[]>
  loadArtifact: (
    protocol: string,
    subjectId: string,
    artifactId: string,
  ) => Promise<Artifact | null>
  loadState: (protocol: string, subjectId: string) => Promise<null | TaskState>
  saveArtifact: (
    protocol: string,
    subjectId: string,
    artifact: Artifact,
  ) => Promise<void>
  saveState: (
    protocol: string,
    subjectId: string,
    state: TaskState,
  ) => Promise<void>
}
