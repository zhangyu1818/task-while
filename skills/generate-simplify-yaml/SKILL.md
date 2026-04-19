---
name: generate-simplify-yaml
description: Use when a user wants a task-while simplify YAML config for ChatGPT and needs a project-specific prompt generated from a standard simplify template.
---

# Generate Simplify YAML

Generate a runnable `simplify.yaml` from project context and [template.md](template.md).

## When to Use

Use this skill when the user wants to:

- create a `task-while simplify` config
- generate a project-specific simplify prompt from a shared template
- reuse a standard simplify workflow instead of drafting the prompt from scratch

Do not use this skill for:

- `while.yaml`
- `batch` configs
- ordinary coding tasks

## Workflow

1. Gather the minimum required project context:
   - project name
   - short project description
   - key repository paths
   - capabilities / UI / config / entry points that must not change
   - recommended verification commands
   - directories or files that should be added to `exclude`
2. Read [template.md](template.md)
3. Replace the template placeholders with real project context
4. Keep the hard constraints from the template:
   - `{{turn}}`
   - `docs/simplify/turn_{{turn}}.md`
   - zip input
   - isolated work directory
   - `.diff` delivery
   - `git apply --check`
5. Write `simplify.yaml`
6. Return the run command: `pnpm exec task-while simplify --config ./simplify.yaml`

## Defaults

If the user does not specify otherwise, use:

- `provider: chatgpt`
- `turns: 5`
- `exclude`:
  - `node_modules/**`
  - `dist/**`
  - `coverage/**`
  - `.while/**`
  - `**/*.zip`
  - `**/*.diff`

Do not exclude `.git` by default.  
Do not add `simplify.yaml` to `exclude`; runtime already excludes the config file itself.

## File Rules

- Write to `simplify.yaml` in the current workspace by default
- If `simplify.yaml` already exists, read it first and let the user decide whether to overwrite it or update it

## Requirements

- Build the prompt from [template.md](template.md)
- Preserve the two core safeguards in the generated prompt:
  - prevent overcomplication
  - prevent misleading surface-level simplification
- Require the final output to be a real `.diff` file, not pasted patch text

## References

Use these files when needed:

- [template.md](template.md)
- [references/simplify-config.md](references/simplify-config.md)
