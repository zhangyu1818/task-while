# task-while batch config reference

This skill generates configs for `task-while batch`.

## Command

```bash
pnpm exec task-while batch --config ./batches/<task-name>.yaml
```

## Runtime behavior

- `task-while batch` does not read `while.yaml`
- The YAML file's directory is the batch root
- `glob` is resolved relative to the YAML file's directory
- `results.json` is written beside the YAML file
- `.while/harness/` runtime state is written under the same directory

If the config is stored under `batches/`, patterns that target workspace-root files often need `../`, for example:

```yaml
glob:
  - '../src/**/*.{ts,tsx}'
```

## Supported fields

Required:

- `provider`
- `prompt`
- `schema`

Optional:

- `model`
- `effort`
- `glob`

## Providers

`provider` accepts:

- `claude`
- `codex`

`claude` effort accepts:

- `low`
- `medium`
- `high`
- `max`

`codex` effort accepts:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

## Schema expectations

`schema` must be a JSON Schema object. The CLI validates structured output against it locally.

Recommended pattern:

```yaml
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

## Example config

```yaml
provider: codex
model: gpt-5.4-mini
effort: high
glob:
  - '../src/**/*.{ts,tsx}'
prompt: |
  Read the target file and return structured output that matches the schema.
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
