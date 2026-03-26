import path from 'node:path'

import * as fsExtra from 'fs-extra'

export function isWithinRelativePath(targetPath: string, basePath: string) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}/`)
}

export function parsePorcelainPath(line: string) {
  const rawPath = line.slice(3).trim()
  const renamedSegments = rawPath.split(' -> ')
  return renamedSegments.at(-1) ?? rawPath
}

export function filterPorcelainStatus(
  lines: string[],
  ignoredBasePath: string,
) {
  return lines.filter((line) => {
    const filePath = parsePorcelainPath(line)
    return !isWithinRelativePath(filePath, ignoredBasePath)
  })
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  const dir = path.dirname(filePath)
  await fsExtra.ensureDir(dir)
  const tempFile = `${filePath}.tmp`
  await fsExtra.writeFile(tempFile, JSON.stringify(value, null, 2))
  await fsExtra.rename(tempFile, filePath)
}
