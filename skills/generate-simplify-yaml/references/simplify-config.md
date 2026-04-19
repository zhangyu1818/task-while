# task-while simplify config reference

This skill generates `simplify.yaml` files for `task-while simplify`.

## Run command

```bash
pnpm exec task-while simplify --config ./simplify.yaml
```

If the user needs to point at an already running browser CDP endpoint:

```bash
pnpm exec task-while simplify --config ./simplify.yaml --cdp-url http://127.0.0.1:9222
```

## Current config format

Required fields:

- `provider`
- `turns`
- `prompt`

Optional fields:

- `exclude`

Constraints:

- `provider` currently supports only `chatgpt`
- `turns` must be a positive integer
- `exclude` may be a string or an array of strings
- `exclude` defaults to an empty array
- `prompt` supports the `{{turn}}` placeholder, which runtime replaces with the current turn number

## Real simplify execution flow

The current implementation works like this:

1. create a zip from the current workspace
2. upload the zip to ChatGPT
3. wait for ChatGPT to produce a downloadable diff result
4. locally watch for and download only `*.diff` files
5. apply the diff with `git apply <diff-file>`
6. commit the applied result if successful

That means the generated prompt must explicitly require:

- a real downloadable `.diff` file as the final artifact
- no pasted diff text in the reply
- a `.diff` file that can be used directly by `git apply`
- a `.diff` file that contains all changes for the current turn
- a final reply that contains only the `.diff` file

## Exclude guidance

`simplify` zips the current workspace and filters files through `exclude`. Recommended defaults:

```yaml
exclude:
  - 'node_modules/**'
  - 'dist/**'
  - 'coverage/**'
  - '.while/**'
  - '**/*.zip'
  - '**/*.diff'
```

Project-specific additions may include:

```yaml
  - 'build/**'
  - '.next/**'
  - 'out/**'
  - 'tmp/**'
  - 'temp/**'
```

Do not exclude `.git` by default.

Runtime already excludes `simplify.yaml` itself, so do not add it manually.

## Why template.md exists

The template lives in `template.md` so the skill can stay focused on generation flow instead of embedding a long prompt body.

Recommended usage order:

1. read `SKILL.md` to understand when and how to use the skill
2. read `template.md` to get the prompt structure
3. fill the template with real project context

## Core anti-bias rule

The generated prompt should explicitly state this rule:

- agents tend to overcomplicate simple problems
- agents also tend to mistake “simplify” for shallow reduction that breaks sound layering and extensibility
- good simplify removes meaningless complexity while preserving low coupling, clear layering, stable boundaries, extensibility, and verifiability

Suggested wording:

```text
You must actively prevent two failure modes:
1. Overcomplication: turning a 100-line problem into a 1000-line solution by adding unnecessary abstraction, configuration, and indirection.
2. Misleading surface-level simplification: making the code look smaller while damaging low coupling, sound layering, clear boundaries, and extensibility.

Good simplify is not “make the code shorter at any cost”. Good simplify removes meaningless complexity while preserving best-practice structure: clear logic, low coupling, sound layering, stable boundaries, extensibility, and verifiability.
```

## Default template location

The default template is here:

- [template.md](../template.md)

When generating `simplify.yaml`, fill it with:

- project name
- short project description
- key repository paths
- verification commands
- user-specific constraints

## Sources

- OpenAI Prompt engineering: structured, layered, concrete instructions  
  [https://developers.openai.com/api/docs/guides/prompt-engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
- OpenAI Codex Prompting Guide: stable starter prompts, autonomy, exploration, tooling, and quality constraints  
  [https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- OpenAI Modernizing your Codebase with Codex: document the plan first, then prove parity and verification  
  [https://developers.openai.com/cookbook/examples/codex/code_modernization](https://developers.openai.com/cookbook/examples/codex/code_modernization)
- Anthropic Prompt engineering overview: define success criteria and evaluation before prompt iteration  
  [https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)
- Anthropic Prompting best practices: direct instructions, structure, and explicit anti-overengineering constraints  
  [https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- Martin Fowler Refactoring: small, behavior-preserving refactoring instead of feature reduction  
  [https://martinfowler.com/books/refactoring.html](https://martinfowler.com/books/refactoring.html)
