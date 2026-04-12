# task-while

`task-while` is a git-first harness runtime built around a task source protocol. The published package name and CLI binary are both `task-while`.

It reads workflow settings from `while.yaml`, opens the configured task source, executes one task at a time, reviews the result, integrates approved work, and creates one git commit per completed task. The built-in task sources are `spec-kit`, which consumes `spec.md`, `plan.md`, and `tasks.md` under `specs/<feature>/`, and `openspec`, which consumes an OpenSpec change under `openspec/changes/<change>/`.

It also provides a standalone `batch` command for YAML-driven file processing that is independent from the feature/task harness runtime workflow.

## Requirements

- Node.js 24 or newer
- For `run`: a git repository with an initial commit
- For `run`: a workspace with the directory layout required by the selected task source
- For `run`: the files required by the selected task source
- For `run`: a clean worktree before `run`

Current built-in source requirements:

- `task.source: spec-kit`
- `specs/<feature>/spec.md`
- `specs/<feature>/plan.md`
- `specs/<feature>/tasks.md`
- `task.source: openspec`
- `openspec/changes/<change>/proposal.md`
- `openspec/changes/<change>/design.md`
- `openspec/changes/<change>/tasks.md`
- At least one file under `openspec/changes/<change>/specs/**/*.md`

## Install

```bash
pnpm add -D task-while
```

Run it with:

```bash
pnpm exec task-while run
```

## Configuration

`while.yaml` configures the `run` workflow only. When it is absent, the CLI runs `task.source: spec-kit`, `task.maxIterations: 5`, and `workflow.mode: direct` with `codex` for both roles. Each workflow role accepts provider-specific `model` and `effort`.

```yaml
task:
  source: spec-kit
  maxIterations: 5

workflow:
  mode: direct
  roles:
    implementer:
      model: gpt-5-codex
      effort: high
    reviewer:
      model: gpt-5-codex
      effort: high
```

Current status:

- `workflow.roles.<role>.provider` accepts `codex` or `claude`; when omitted it defaults to `codex`, including roles that only set `model` and/or `effort`
- `codex` `effort` accepts `minimal`, `low`, `medium`, `high`, or `xhigh`
- `claude` `effort` accepts `low`, `medium`, `high`, or `max`
- `workflow.mode: direct` requires `implementer` and `reviewer` to use identical `model` and `effort` when they share the same provider
- `workflow.mode: direct` uses a local reviewer
- `workflow.mode: pull-request` pushes a task branch, polls GitHub PR review from `chatgpt-codex-connector[bot]`, then squash-merges on approval
- in `workflow.mode: pull-request`, reviewer `provider` still selects the remote reviewer, but any local reviewer `model` and `effort` values are ignored
- `workflow.mode: pull-request` currently supports only `codex` as the remote reviewer provider
- `task.maxIterations` uses the same configured limit for every task in the selected source session; run workflow retries share a single per-task budget across phases

Example pull-request mode:

```yaml
workflow:
  mode: pull-request
  roles:
    implementer:
      provider: claude
      model: claude-sonnet-4-6
      effort: max
    reviewer:
      provider: codex
```

## Workspace Resolution

`task-while run` resolves the current working directory as the workspace root.

- `task.source: spec-kit` requires `cwd/specs`
- `task.source: openspec` requires `cwd/openspec/changes`
- if the required source root is missing, the CLI fails with a clear user-facing error

Feature resolution order:

1. `--feature`
2. current git branch prefix for `spec-kit`
3. the only entry under the selected source root

For `task.source: openspec`, `--feature` identifies the OpenSpec change id.

## Commands

### `task-while run`

Runs the current feature workflow from the existing `.while` state or initializes a new one. Run it from the workspace root so the current directory contains the source-specific root, such as `specs/` for `spec-kit` or `openspec/changes/` for `openspec`.

```bash
cd /path/to/workspace
pnpm exec task-while run --feature 001-demo
```

Useful flags:

- `--feature <featureId>`: select the feature explicitly
- For `task.source: openspec`, `--feature <featureId>` selects the OpenSpec change id
- `--until-task <taskSelector>`: stop after the target task reaches `done`
- `--verbose`: stream direct provider details to `stderr`, including Claude init/task/tool/result summaries and Codex thinking, commands, MCP tools, file updates, todo changes, messages, and final usage

### `task-while batch`

Runs a standalone YAML-driven batch job. This command does not read `while.yaml`, does not require `specs/`, and does not use the task-source workflow.

```bash
cd /path/to/workspace
pnpm exec task-while batch --config ./batch.yaml
```

This repository also includes a repo-local skill at `skills/generate-batch-yaml/` for generating batch configs from natural-language requirements.

Batch config example:

```yaml
provider: claude
model: claude-sonnet-4-6
effort: max
glob:
  - 'src/**/*.{ts,tsx}'
prompt: |
  Read the target file and return structured output for it.
schema:
  type: object
  properties:
    summary:
      type: string
    tags:
      type: array
      items:
        type: string
  required:
    - summary
```

Batch behavior:

- `glob` is optional and defaults to `**/*`
- `glob` is resolved relative to the directory that contains `batch.yaml`
- `provider`, `prompt`, and `schema` are required
- `model` and `effort` are optional and are forwarded to the selected provider client
- batch `provider` accepts `codex` or `claude`
- batch `codex` `effort` accepts `minimal`, `low`, `medium`, `high`, or `xhigh`
- batch `claude` `effort` accepts `low`, `medium`, `high`, or `max`
- each run scans files under the `batch.yaml` directory and filters them by `glob`
- structured results are written beside the YAML file in `results.json`
- internal harness state is written under `.while/harness/` beside the YAML file
- result keys are relative to the directory that contains `batch.yaml`
- `--verbose` streams direct provider details to `stderr` during batch execution, including Claude init/task/tool/result summaries and Codex thinking, commands, MCP tools, file updates, todo changes, messages, and final usage
- rerunning the command resumes unfinished work and skips files that already have accepted results
- failed files are suspended and retried after all pending files are processed
- file-level retries are limited by `maxRetries` (default 3); exhausted files are marked blocked
- when `glob` matches no files, the command exits successfully without initializing a provider

## Task Lifecycle

Each task follows this lifecycle:

1. The implement role receives a task-source-built prompt for the current task.
2. The reviewer evaluates the task-source-built review prompt plus changed-file context and overall risk.
3. If review is approved, `task-while` asks the task source to apply its completion marker, creates the final integration commit, and records integrate artifacts under `.while`.

Completion requires all of the following:

- review verdict `pass`
- no findings
- every acceptance check passing

Review context uses `actualChangedFiles` derived from git diff against `HEAD`. In `pull-request` mode, changed-file context comes from the live PR snapshot instead of the local worktree diff.

In `pull-request` mode:

- review creates or reuses `task/<slug>` and an open PR against `main`
- if an open PR exists but the local task branch is missing, review restores the branch from `origin/task/<slug>`
- review creates a checkpoint commit with `checkpoint: Task <taskId>: <title> (attempt <n>)`
- review polls every minute with no default timeout
- review evaluates approval from a fully paginated live GraphQL PR snapshot
- approval is driven by the freshest `chatgpt-codex-connector[bot]` signal after the checkpoint commit
- active feedback includes unresolved, non-outdated review threads plus reviewer-authored review summaries and discussion comments after the current checkpoint
- process restart re-enters `review` or `integrate` and continues the same PR flow
- if the PR was already squash-merged before state was persisted, integrate treats it as already completed and finalizes local cleanup on resume
- integrate checks the task source completion marker, creates the final task commit when needed, squash-merges, returns to `main`, and deletes the local task branch

Completion is git-first:

- one completed task = one git commit
- `.while` is runtime state and is not committed
- completed task state stores `commitSha`

## Built-in `spec-kit` Expectations

The built-in `spec-kit` task source parses raw Spec Kit task lines in file order. It does not require enhanced per-task metadata blocks.

Example:

```md
## Phase 1: Core

- [ ] T001 Implement greeting
- [ ] T002 [P] Implement farewell
- [ ] T010 [P] [US1] Add scenario coverage
```

Current built-in `spec-kit` behavior:

- task ordering follows the order in `tasks.md`
- explicit task dependencies are not extracted from raw task lines
- implement/review prompts include the current task line, the current phase, `spec.md`, `plan.md`, and the full `tasks.md`
- completion is still written back through `tasks.md` checkboxes

## Built-in `openspec` Expectations

The built-in `openspec` task source consumes an existing OpenSpec change directory and aligns implement/review prompts with `openspec instructions apply --json`.

Example configuration:

```yaml
task:
  source: openspec
  maxIterations: 5
```

Example run:

```bash
pnpm exec task-while run --feature example-change
```

Current built-in `openspec` behavior:

- `--feature` maps to `openspec/changes/<change>`
- stable task handles come from explicit numbering in `tasks.md`, such as `1.1` and `2.3`
- implement/review prompts include the current task, task group, `proposal.md`, `design.md`, expanded `specs/**/*.md`, full `tasks.md`, and the OpenSpec apply instruction/state/progress
- completion is still written by `task-while` after review/integrate success; it does not adopt `/opsx:apply`'s immediate checkbox update behavior
- `task-while` consumes OpenSpec artifacts and CLI JSON, but it does not run `/opsx:propose`

Task retry budget is configured globally in `while.yaml`:

```yaml
task:
  maxIterations: 2
```

## What `task-while` Does Not Do

`task-while` does not replace Spec Kit's project-level workflow. It does not run Spec Kit commands, checklists, or hooks.

Its contract with the selected task source is simple:

- the task source parses source artifacts and provides prompts plus completion operations
- the harness runtime drives implement, review, integrate, and persistence around that protocol

The standalone `batch` command is separate from this contract. It does not use task sources, task graphs, review/integrate stages, or git-first completion.

## Architecture

`task-while` uses a state-machine control plane:

- **TaskState** per subject is the single source of truth, written atomically as JSON
- **Transition log** (append-only JSONL) records phase transitions for debugging
- **Artifacts** store large structured outputs (contracts, reviews, implementations) separately
- A **pure kernel interpreter** executes typed workflow programs (action/gate/branch nodes + declarative transition tables)
- A **session layer** drives multi-subject scheduling via pluggable schedulers
- All external effects flow through unified **ports** (AgentPort, CodeHostPort, GitPort)

## Runtime Layout

`run` keeps runtime state under:

```text
<source-entry>/<id>/.while/harness/
  state/<protocol>/<subject-id>.json         — TaskState per subject (truth)
  transitions/<protocol>/<subject-id>.jsonl  — TransitionRecord log (debug)
  artifacts/<protocol>/<subject-id>/*.json   — Artifact per kind/iteration
```

`.while` is runtime state, not the long-term source of truth. Resume reads the state file directly — no event replay needed.

`batch` keeps runtime files beside the YAML config:

```text
<config-dir>/
├── batch.yaml
├── results.json
└── .while/harness/
    ├── state/batch/*.json
    ├── transitions/batch/*.jsonl
    └── artifacts/batch/...
```

`results.json` maps accepted structured output by file path relative to the `batch.yaml` directory. If the config lives under a subdirectory and uses patterns such as `../input/*.txt`, the keys keep that relative form.

## Publishing

Before publishing:

```bash
pnpm lint
pnpm typecheck
AI_AGENT=1 pnpm test
AI_AGENT=1 pnpm tsx fixtures/smoke/codex-e2e.ts
npm pack --dry-run
```
