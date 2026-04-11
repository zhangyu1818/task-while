import { appendFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { pathExists, readJson } from 'fs-extra'

import type { HarnessStore } from '../../harness/store'

export function createFsHarnessStore(root: string): HarnessStore {
  const stateFile = (protocol: string, subjectId: string) =>
    path.join(root, 'state', protocol, `${encodeURIComponent(subjectId)}.json`)

  const artifactFile = (
    protocol: string,
    subjectId: string,
    artifactId: string,
  ) =>
    path.join(
      root,
      'artifacts',
      protocol,
      encodeURIComponent(subjectId),
      `${artifactId}.json`,
    )

  const artifactDir = (protocol: string, subjectId: string) =>
    path.join(root, 'artifacts', protocol, encodeURIComponent(subjectId))

  const transitionFile = (protocol: string, subjectId: string) =>
    path.join(
      root,
      'transitions',
      protocol,
      `${encodeURIComponent(subjectId)}.jsonl`,
    )

  return {
    async appendTransition(protocol, subjectId, record) {
      const file = transitionFile(protocol, subjectId)
      await mkdir(path.dirname(file), { recursive: true })
      await appendFile(file, `${JSON.stringify(record)}\n`)
    },
    async listArtifacts(protocol, subjectId) {
      const dir = artifactDir(protocol, subjectId)
      if (!(await pathExists(dir))) {
        return []
      }
      const directoryEntries = await readdir(dir)
      const entries = directoryEntries.filter((e) => e.endsWith('.json'))
      return Promise.all(
        entries.map((entry) => readJson(path.join(dir, entry))),
      )
    },
    async loadArtifact(protocol, subjectId, artifactId) {
      const file = artifactFile(protocol, subjectId, artifactId)
      if (!(await pathExists(file))) {
        return null
      }
      return readJson(file)
    },
    async loadState(protocol, subjectId) {
      const file = stateFile(protocol, subjectId)
      if (!(await pathExists(file))) {
        return null
      }
      return readJson(file)
    },
    async saveArtifact(protocol, subjectId, artifact) {
      const file = artifactFile(protocol, subjectId, artifact.id)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(artifact, null, 2))
    },
    async saveState(protocol, subjectId, state) {
      const file = stateFile(protocol, subjectId)
      const tmpFile = `${file}.tmp`
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(tmpFile, JSON.stringify(state, null, 2))
      await rename(tmpFile, file)
    },
  }
}
