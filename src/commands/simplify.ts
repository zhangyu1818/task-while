import { runSimplifyTurn } from '../simplify/chatgpt-provider'
import { loadSimplifyConfig } from '../simplify/config'
import { runSimplify } from '../simplify/runner'

export interface RunSimplifyCommandInput {
  cdpUrl?: string
  configPath: string
  cwd: string
  verbose?: boolean
}

export async function runSimplifyCommand(input: RunSimplifyCommandInput) {
  const config = await loadSimplifyConfig({
    configPath: input.configPath,
    cwd: input.cwd,
  })

  return runSimplify({
    config,
    cwd: input.cwd,
    runTurn: (options) =>
      runSimplifyTurn({
        ...options,
        ...(input.cdpUrl ? { cdpUrl: input.cdpUrl } : {}),
      }),
    ...(input.verbose != null ? { verbose: input.verbose } : {}),
  })
}
