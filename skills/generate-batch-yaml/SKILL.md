---
name: generate-batch-yaml
description: Use when a user wants a task-while batch YAML config generated from a natural-language requirement for local file processing.
---

# Generate Batch YAML

Create a runnable `task-while batch` config from the user's requirement, write it into the current workspace, and return the exact command to run it.

Do not use this skill for `while.yaml` or `simplify.yaml`.

## Output Contract

When this skill completes, it must:

1. Write a YAML file to `batches/<task-name>.yaml` by default
2. Return the exact run command:
   `pnpm exec task-while batch --config ./batches/<task-name>.yaml`
3. Briefly summarize what the batch job does

If `batches/<task-name>.yaml` already exists, read it first and ask whether to overwrite it or update it.

## Required Discovery

Before writing YAML, make sure these inputs are clear enough:

- which files the batch should process
- what the batch should extract, classify, transform, or summarize
- what structured fields must exist in the output
- which fields are required
- which provider to use: `claude` or `codex`

If the provider is already specified, use it. If not, ask. Ask only focused follow-up questions for missing information. Do not generate the file from a vague requirement.

## Task Name

- derive the task name from the requirement
- use lowercase letters, digits, and hyphens only
- keep it short and descriptive
- default output path is `batches/<task-name>.yaml`

Examples:

- `summarize-api-routes`
- `extract-component-inventory`
- `classify-support-tickets`

## YAML Rules

Generate a complete YAML document that matches the current `task-while batch` contract:

- `provider`, `prompt`, and `schema` are required
- `glob` is optional and defaults to `**/*`
- `glob` can be a single string or a list of strings
- `model`, `effort`, and `timeout` are optional; include them only when the user asks to pin them or when the requirement depends on them
- `schema` must be an object schema

The `prompt` must tell the model to read the target file and return structured output that matches the schema. Keep it specific enough that local schema validation is likely to pass.

## Schema Rules

The schema must be concrete and directly useful. Avoid placeholder fields.

Recommended pattern:

- top-level `type: object`
- `properties` for every expected field
- `required` listing fields that must always exist
- `additionalProperties: false` on object schemas
- `items` for arrays
- nested `properties` for nested objects

If `provider` is `codex`, use Codex-compatible strict schemas:

- every object schema, including nested objects, must set `additionalProperties: false`
- every declared property must appear in `required`
- if a field is semantically optional, keep it in `required` and allow `null` in its type instead of omitting it

If the user describes outcomes loosely, translate them into stable fields. Examples:

- "tell me what the file does" -> `summary: string`
- "tag the main topics" -> `tags: string[]`
- "score complexity from 1 to 5" -> `complexityScore: integer`

## File Writing Workflow

1. Understand the requirement
2. Ask only the missing questions needed to define `provider`, `glob`, `prompt`, and `schema`
3. Derive the task name
4. Ensure the `batches/` directory exists
5. Write `batches/<task-name>.yaml`
6. Reply with the created file path, a short summary, and the exact run command

## Batch Root Reminder

`task-while batch` uses the YAML file's directory as the batch root. That means:

- `glob` is resolved relative to the YAML file's directory
- `results.json` is written beside the YAML file
- `.while/` runtime state is written under the same directory

If the config lives under `batches/` and the user's actual files live at the workspace root, use patterns such as `../src/**/*.ts` instead of `src/**/*.ts`.

## Reference

For the exact supported config shape and current CLI behavior, read [references/batch-config.md](references/batch-config.md).
