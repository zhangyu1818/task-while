import path from 'node:path'

import { glob } from 'glob'

export interface DiscoverBatchFilesInput {
  baseDir: string
  excludedFiles: Set<string>
  patterns: string[]
}

function normalizeBatchPath(value: string) {
  return value.split(path.sep).join('/')
}

export async function discoverBatchFiles(
  input: DiscoverBatchFilesInput,
): Promise<string[]> {
  const excluded = new Set(
    [...input.excludedFiles].map((filePath) =>
      normalizeBatchPath(path.relative(input.baseDir, filePath)),
    ),
  )
  const matched = await glob(input.patterns, {
    absolute: false,
    cwd: input.baseDir,
    dot: true,
    ignore: ['.git/**', 'node_modules/**'],
    nodir: true,
    posix: true,
  })

  return [...new Set(matched.map(normalizeBatchPath))]
    .filter((filePath) => !excluded.has(filePath))
    .sort((left, right) => left.localeCompare(right))
}
