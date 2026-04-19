# Simplify Prompt Template

Use this template to generate the `prompt` field inside a project-specific `simplify.yaml`.  
The default mode is `review-first + safe fixes`.

Fill rules:

- Replace angle-bracket placeholders with real project context
- Preserve `{{turn}}`
- Preserve `docs/simplify/turn_{{turn}}.md`
- If the repository does not have a traditional UI, interpret “UI unchanged” as “user-visible behavior unchanged”
- If the user explicitly wants stronger behavior-preserving convergence refactoring, keep the structure and adjust the responsibility and allowed-change sections
- Do not remove the hard constraints around zip input, isolated work directory, documentation-first flow, `.diff` delivery, and `git apply --check`

---

The current project is <project name>.

Project summary:
<one sentence describing what the project is, what it does, and who it is for>

Key repository paths:
- <key path 1>
- <key path 2>
- <key path 3>

Start simplify review turn `{{turn}}`.

Your job is to review code quality first, then make the smallest necessary fixes. In this project, simplify defaults to “code review + safe fixes”, not “product simplification” or “feature reduction”.

If the repository already contains previous `docs/simplify/turn_*.md` files, read them first to understand prior work, prior findings, and the current turn context.

You must actively prevent two failure modes:
1. Overcomplication: turning a 100-line problem into a 1000-line solution by adding unnecessary abstraction, configuration, and indirection.
2. Misleading surface-level simplification: making the code look smaller while damaging low coupling, sound layering, clear boundaries, and extensibility.

Good simplify is not “make the code shorter at any cost”. Good simplify removes meaningless complexity while preserving best-practice structure: clear logic, low coupling, sound layering, stable boundaries, extensibility, and verifiability.

Focus areas:
1. useless code, dead code, unreachable branches, broken abstractions, unnecessary indirection
2. whether component / type / file splits are reasonable, and whether responsibilities, boundaries, and naming are clear
3. duplicated implementations and logic that should be shared but is repeated
4. state flow, dependency relationships, and logic clarity
5. whether tests cover real behavior and whether any tests are misleading
6. which issues should only be documented as suggestions, and which can be fixed safely with zero behavior change

Required boundaries:
- Do not remove existing features, settings, entry points, styles, or user capabilities just because “fewer files / fewer components / less configuration / fewer visual paths” looks simpler
- Do not treat feature removal as the default action
- If something looks removable, but zero behavior change cannot be proven, document it as a candidate suggestion and do not change the implementation
- Merge files, merge components, or delete code only when zero behavior change can be clearly proven
- A split is not a problem by itself; if it improves responsibility clarity, boundary stability, or comprehension, keep it
- Do not treat “fewer files / fewer components / fewer layers” as a goal by itself
- Do not trade away sound low coupling, clear layering, or extension boundaries for surface-level simplicity

Behavior rules:
- Think before coding: do not make silent assumptions; if multiple interpretations exist, recognize them first
- Simplicity first: make only the smallest change required for the current task
- Surgical changes: do not refactor unrelated areas
- Goal-driven verification: every change must map to a concrete verification step
- Avoid overengineering: do not add one-off abstractions and do not design for hypothetical future needs
- Decision test: if an option only makes the code shorter but harms clarity, coupling control, extensibility, or verifiability, it is not a good simplify outcome

Inputs:
- Current project zip: the zip archive created from the current repository
- Current review document path: `docs/simplify/turn_{{turn}}.md`; create it if missing, overwrite it if it already exists for this turn

Execution steps:
1. Unzip the archive
2. Copy the unzipped project into a new working directory outside the original extracted directory
3. Make all changes only inside the new working directory
4. Analyze the current code structure, main flows, and test structure
5. Write `docs/simplify/turn_{{turn}}.md` before any implementation change
6. The document must include at least:
   - a summary of the current main flows and existing functionality
   - current review findings
   - evidence for each finding
   - a recommended handling approach for each finding
   - a clear separation between “document only, no implementation change” and “safe zero-behavior-change fix”
   - the verification plan for this turn
7. Do not start any implementation change before the review document is written
8. Implementation changes must be minimal, low-risk, and provably zero-behavior-change
9. Run whatever verification is feasible in the current environment; prioritize tests directly related to this turn’s changes
10. Generate a unified diff / git-style patch file
11. The diff must include:
    - `docs/simplify/turn_{{turn}}.md`
    - at least one safe fix in code, tests, or necessary config by default
    - only if there is truly nothing worth changing after careful review may the diff contain only the review document
12. Save the diff as a real `.diff` file on disk
13. Before final output, run `git apply --check <diff-file>` at the root of the original extracted directory; if it fails, keep fixing until it applies cleanly

Output requirements:
- Final reply must contain only one downloadable `.diff` file
- Do not paste diff text
- Write findings, change rationale, verification results, and residual risks into `docs/simplify/turn_{{turn}}.md`

Hard constraints:
- Preserve the full simplify workflow: zip input, isolated working directory, and `.diff` delivery
- Do not invent repository paths or directories that do not exist in the current project
- Keep all changes scoped to real files and directories in the repository
- If you are not sure whether a change is behavior-safe, do not change the implementation; record it in the document instead
- If you are not sure whether code is truly useless, do not delete it; record it as suspicious instead
- Do not introduce new large architecture layers, protocol layers, plugin points, or generalized abstraction systems
