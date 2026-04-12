---
name: generate-batch-yaml
description: Use when a user wants to create a task-while batch YAML file from a natural-language requirement and needs the agent to ask clarifying questions, generate a complete local config, and provide the run command.
---

# Generate Batch YAML

Create a runnable `task-while batch` config from the user's requirement, write it to the local workspace, and return the exact command to run it.

Do not use this skill to edit `while.yaml` for the task harness. This skill is only for `task-while batch`.

## Output Contract

When this skill completes, it must:

1. Write a local YAML file to `batches/<task-name>.yaml`
2. Inline the full `schema` inside the YAML file
3. Return the run command:
   `pnpm exec task-while batch --config ./batches/<task-name>.yaml`

If `batches/<task-name>.yaml` already exists, read it first and ask whether to overwrite or update it.

## Provider Rules

- If the user already said `Claude` or `Codex`, use that provider without asking again
- If the provider is not specified, ask which provider to use before writing the file
- Claude defaults:
  - `provider: claude`
  - `model: sonnet`
  - `effort: medium`
- Codex defaults:
  - `provider: codex`
  - `model: gpt-5.4-mini`
  - `effort: high`

Only ask follow-up questions about `model` or `effort` if the user wants to override the defaults.

## Required Discovery

Before writing YAML, make sure these inputs are clear enough:

- What files should the batch process
- What the batch should extract, classify, transform, or summarize
- What structured fields must exist in the output
- Which fields are required

If any of that is still ambiguous, ask focused follow-up questions first. Do not generate the file from a vague requirement.

## Task Name

- Derive the task name from the user's requirement
- Use lowercase letters, digits, and hyphens only
- Keep it short and descriptive
- Default output path is `batches/<task-name>.yaml`

Examples:

- `summarize-api-routes`
- `extract-component-inventory`
- `classify-support-tickets`

## YAML Rules

Generate a complete YAML document that matches the current `task-while batch` contract:

- `provider` is required
- `prompt` is required
- `schema` is required and must be an object schema
- `glob` is optional, but if the target file set is known, include it explicitly instead of relying on `**/*`
- `model` and `effort` should be included using the provider defaults unless the user asked for different values

The `prompt` must instruct the model to read the target file and return data that conforms to the schema. Keep the prompt precise enough that the output validator is likely to pass.

## Schema Rules

The schema must be concrete and directly useful. Avoid placeholder schemas.

Good pattern:

- top-level `type: object`
- `properties` for every expected field
- `required` listing the fields that must always exist
- `additionalProperties: false` on every object schema
- nested `items` for arrays
- nested `properties` for objects

If `provider` is `codex`, use Codex-compatible strict schemas:

- every object schema, including nested objects, must set `additionalProperties: false`
- every declared property must appear in `required`
- if a field is semantically optional, keep it in `required` and allow `null` in its type instead of omitting it

If the user only describes outcomes loosely, translate them into stable fields. Example:

- "tell me what the file does" -> `summary: string`
- "tag the main topics" -> `tags: string[]`
- "score complexity from 1 to 5" -> `complexityScore: integer`

## File Writing Workflow

1. Understand the requirement
2. Ask only the missing questions needed to define `provider`, `glob`, `prompt`, and `schema`
3. Derive the task name
4. Ensure the `batches/` directory exists
5. Write `batches/<task-name>.yaml`
6. Reply with:
   - the created file path
   - a short summary of what the batch does
   - the exact run command

## Batch Root Reminder

`task-while batch` uses the YAML file's directory as the batch root. That means:

- `glob` is resolved relative to `batches/`
- `results.json` is written beside the YAML file
- `.while/harness/` state is also written under `batches/`

When selecting `glob`, account for the fact that the config lives under `batches/`. If the user's actual files live at the workspace root, use patterns such as `../src/**/*.ts` instead of `src/**/*.ts`.

## Reference

For the exact supported config shape and current CLI behavior, read [references/batch-config.md](references/batch-config.md).
