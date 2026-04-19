# task-while batch config reference

This skill generates configs for `task-while batch`.

## Command

```bash
pnpm exec task-while batch --config ./batches/<task-name>.yaml
```

## Runtime behavior

- `task-while batch` does not read `while.yaml`
- the YAML file's directory is the batch root
- `glob` is resolved relative to the YAML file's directory
- `results.json` is written beside the YAML file
- `.while/` runtime state is written under the same directory
- result keys in `results.json` are relative to the YAML file's directory

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

- `glob`
- `model`
- `effort`
- `timeout`

`glob` defaults to `**/*` and may be either a single string or a list of strings.

## Providers

`provider` accepts:

- `claude`
- `codex`

`claude` `effort` accepts:

- `low`
- `medium`
- `high`
- `max`

`codex` `effort` accepts:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

`timeout` is an optional per-file timeout in milliseconds. It must be a positive integer no larger than `2147483647`.

## Schema expectations

`schema` must be a JSON Schema object. The CLI validates structured output against it locally.

When `provider: codex`, the schema must also satisfy Codex structured output constraints:

- every object schema must set `additionalProperties: false`
- every declared property must appear in `required`
- nested object schemas must follow the same rules
- if a field is optional in meaning, encode it as nullable instead of omitting it from `required`

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
  additionalProperties: false
  required:
    - summary
    - tags
```

## Example config

```yaml
provider: codex
model: gpt-5-codex
effort: high
timeout: 300000
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
  additionalProperties: false
  required:
    - summary
    - tags
```
