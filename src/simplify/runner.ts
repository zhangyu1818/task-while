import type { SimplifyConfig } from './config'

export interface SimplifyTurnOptions {
  configPath: string
  cwd: string
  exclude: string[]
  prompt: string
  turn: number
}

export interface RunSimplifyInput {
  config: SimplifyConfig
  cwd: string
  runTurn: (options: SimplifyTurnOptions) => Promise<void>
  verbose?: boolean
}

export interface RunSimplifyResult {
  completedTurns: number
  totalTurns: number
}

function renderPrompt(template: string, turn: number): string {
  return template.replaceAll('{{turn}}', String(turn))
}

function writeVerboseLine(verbose: boolean | undefined, line: string) {
  if (!verbose) {
    return
  }
  process.stderr.write(`[simplify] ${line}\n`)
}

export async function runSimplify(
  input: RunSimplifyInput,
): Promise<RunSimplifyResult> {
  const { config, cwd, runTurn, verbose } = input

  for (let turn = 1; turn <= config.turns; turn++) {
    writeVerboseLine(verbose, `starting turn ${turn}/${config.turns}`)
    await runTurn({
      configPath: config.configPath,
      cwd,
      exclude: config.exclude,
      prompt: renderPrompt(config.prompt, turn),
      turn,
    })
    writeVerboseLine(verbose, `turn ${turn}/${config.turns} completed`)
  }

  return { completedTurns: config.turns, totalTurns: config.turns }
}
