# AGENTS.md

<!-- OB-NOT-INITIALIZED -->

# Agent operating guide

This guide defines the common operating contract for AI agents in this repository.
It is agent-agnostic and works with OpenCode, Claude Code, Codex, Gemini, and other agents.

## Purpose and scope

Use this file for repository-wide workflow rules. Keep product architecture, security constraints, and design rules in their source documents rather than duplicating them here.

## Session context

Before a non-trivial change, read these documents in order:

1. `AGENTS.md` for workflow and repository rules.
2. `ARCHITECTURE.md` for boundaries, dependencies, and component interactions.
3. `DESIGN.md` for UI and design-system work.
4. The active OpenSpec change or the relevant specification for the area being changed.

Read each document once per session unless it changes or the task moves into a different area.

Command aliases: OpenSpec skills may reference `/opsx-propose`, `/opsx-apply`, `/opsx-archive`, or `/opsx-explore`. Always substitute them with the `ob-plan-propose`, `ob-plan-apply`, `ob-plan-archive`, and `ob-plan-explore` skills respectively. User-facing command names are `/plan-propose`, `/plan-apply`, `/plan-archive`, and `/plan-explore`. Never mention the `opsx-` names to the user.

## Workflow ownership

<!-- OB-PLATFORM-WORKFLOW-START -->
When the user provides a work item URL or says "implement the plan" or "I've added comments to the PR", **I own the full lifecycle**. I load the appropriate userstory skill and coordinate implementation as native subagent waves via the `ob-plan-apply` skill.

Trigger patterns, I recognize ALL of these, exact wording does not matter:
- User pastes or mentions a GitHub Issue URL → load `ob-userstory` skill → parse issue → load the `ob-plan-propose` skill → confirm with user → load the `ob-plan-apply` skill → ship
- `implement the plan` / `implement` / `start` / `go` → load the `ob-plan-apply` skill → ship
- `I've added comments to the PR` → read PR comments → fix → update PR
- Any GitHub PR URL in a feedback/fix request (e.g. "check comments", "fix PR feedback") → run PR Feedback Loop

**A GitHub URL in the user's message is a strong trigger: follow the pipeline unless the user explicitly asks for analysis or context only.**
<!-- OB-PLATFORM-WORKFLOW-END -->

## Planning and execution

- Plan before delegating work. Use OpenSpec when the change needs explicit scope, decisions, or sequenced tasks.
- Keep changes focused. Do not combine unrelated refactors with requested work.
- Do not guess when requirements, architecture, or security constraints are unclear. Ask before proceeding.
- Prefer the project's established patterns and source documents over introducing new conventions.

## Engineer selection

Inspect `.opencode/agents/*.md` before spawning. Prefer the most specialized custom engineer. `fullstack-engineer` is `mode: primary`, the planning agent, and is not a spawned worker. If no specialist matches, tell the user to create one with `/make-engineer`. Spawn only engineers present in that directory.

| Agent | File | Role |
|---|---|---|
| `fullstack-engineer` | `.opencode/agents/fullstack-engineer.md` | Default planning agent (mode: primary, not spawnable) |
| `devops-engineer` | `.opencode/agents/devops-engineer.md` | Docker, CI/CD, K8s, IaC, observability |
| `platform-engineer` | `.opencode/agents/platform-engineer.md` | TypeScript, Node.js, React, SQLite, feature flags, background jobs |

The `ob-plan-apply` skill is authoritative for subagent waves, dependency ordering, retries, and concurrency. Read `agents.maxConcurrent` from `.opencode/opencode-onboard.json` before spawning workers.

## Tool and repository safety

- Never expose or commit secrets, credentials, tokens, or production data.
- Read before editing. Respect repository ownership, generated files, and existing local changes.
- Run only commands appropriate to the task. Do not bypass checks, weaken tests, or silence lint rules to get a green result.
- Commit, push, create pull requests, alter dependencies, or change deployment configuration only with the user's explicit approval and the repository's stated process.

## Verification and completion

- Run the applicable tests, lint, typecheck, and build before reporting completion.
- A bug fix needs a test that would have caught the defect when practical.
- Update specifications, architecture, or design documentation when the change makes their current statements inaccurate.
- Report changed files, checks run, and any remaining risk or follow-up work.

## Communication

- Keep updates concise and factual.
- State blockers early and explain the decision needed.
- Use the repository's language and writing conventions for source, documentation, issues, commits, and pull requests.
- Comments explain non-obvious reasons, constraints, or invariants. Do not add comments that restate code.

## Skills

Skills live in `.agents/skills/`. Always installed: `@ob-guardrails-generic`, `@ob-guardrails-project`, and `@browser-automation`. Agents load them via `@skill-name` in their `## Abilities` section.

<!-- OB-PLATFORM-SKILLS-GUIDE-START -->
Platform skills (GitHub):
- `@ob-userstory`: load when a GitHub Issue URL is detected. Fetches the issue via `gh` CLI and creates an OpenSpec change. NEVER use webfetch to access GitHub URLs.
- `ob-ops-ship`: load in ship mode to create a PR with screenshots, or in feedback mode to read and classify PR review comments.
<!-- OB-PLATFORM-SKILLS-GUIDE-END -->

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
