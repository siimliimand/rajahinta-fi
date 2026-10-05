---
name: ob-ops-finish
description: Finish a completed OpenSpec change on a feature branch — archive the change, create the PR, watch GitHub Actions until green (fix-and-rewatch loop), merge the PR, then sync the default branch. Invoked by the /finish command.
license: MIT
---

# Ops Finish

Close out a finished feature branch end to end: archive → PR → CI to green → merge → synced default branch.

## Input

The caller provides (all optional):
- A change id to finish. When absent, detect it (Stage 0).
- A skip hint `no-archive` — the change is already archived; start at Stage 2.

## Hard rules

- **GitHub only through the `gh` CLI**, always with `--repo {owner}/{repo}` explicit. Never webfetch, HTTP, or browser tools for GitHub. If `gh` is unavailable or unauthenticated, report as a blocker and stop.
- **Never push the default branch.** The default branch changes only through PR merge.
- **Fix-forward only.** No force-push, no `--admin` merge override, no weakening/disabling checks or tests to get green.
- **Max 3 CI fix rounds.** A round = diagnose → fix → commit → push → re-watch. Exhausted rounds: stop, leave the PR open, report.
- Commit specific paths (`git add <paths>`), never `git add .`.
- Keep credentials and tokens out of logs and output.

## Stage 0: Preflight

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
BRANCH="$(git branch --show-current)"
DEFAULT_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
OWNER_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
```

1. `$BRANCH` must be a work branch (`feature/*` or `bugfix/*`). On the default branch there is nothing to finish: report and stop.
2. **Working tree** must be clean (`git status --porcelain`). If dirty: changes that belong to this change → commit them (`git add <paths> && git commit -m "finish: residual changes"`); anything unrelated → show `git status --short`, ask the user, stop until resolved.
3. **Resolve the change** (skip when a change id was given or `no-archive`):
   - List top-level `openspec/changes/` dirs excluding `archive/`.
   - Exactly one with every `tasks.md` checkbox `[x]` → candidate.
   - Several active changes → ask the user which one.
   - None or none complete → if a PR is already open for `$BRANCH` (`gh pr list --head "$BRANCH" --state open`), skip Stage 1; otherwise report and stop.
4. **Confirm the plan** with the user before any irreversible step:

   ```text
   Finish plan
     Change:  {change-id} ({N}/{M} tasks)
     Branch:  $BRANCH
     Base:    $DEFAULT_BRANCH
     Will do: archive → push → PR → CI to green → merge → sync $DEFAULT_BRANCH
   Proceed? [yes/no]
   ```

   Stop if not confirmed.

## Stage 1: Archive

1. Load `@ob-plan-archive` in **autonomous** mode with `{change-id}`. It archives in place, verifies `ARCHIVED_OK`, and updates `ARCHITECTURE.md` / `DESIGN.md` / guardrails without committing.
2. Require `ARCHIVED_OK` (change dir gone, dated copy under `openspec/changes/archive/`). On failure after its retry: report and stop.
3. Commit and keep the tree clean:

   ```bash
   git add -A && git commit -m "archive: {title} ({change-id})"
   ```

## Stage 2: Push and open the PR

1. Push the branch:

   ```bash
   git push -u origin "$BRANCH"
   ```

2. Load `@ob-ops-ship` and follow its PR-creation steps (skip its commit stage — the tree is already clean; screenshots optional and only when UI changed and a dev server is actually available). Derive title and body from the change: title `feat({scope}): {change-id} — {one-line summary}`, body with the functional summary, delivered items from `tasks.md`, verification results, and the archive path.
3. Record `{pr-number}` and `{pr-url}`:

   ```bash
   gh pr view "$BRANCH" --repo "$OWNER_REPO" --json number,url -q '{n: .number, u: .url}'
   ```

## Stage 3: CI to green (watch–fix loop)

1. **Wait for checks to register** (they appear seconds after the PR opens):

   ```bash
   gh pr checks "{pr-number}" --repo "$OWNER_REPO"
   ```

   If it reports "no checks", sleep ~30 s and retry (cap ~5 min). Still none: the PR has no CI — ask the user whether to merge anyway.
2. **Watch** (progress display only — this gh version can exit 0 while checks are still failing, as seen on PR #88):
   ```bash
   gh pr checks "{pr-number}" --repo "$OWNER_REPO" --watch --interval 30
   ```
3. **Verify authoritatively** — the plain re-run's exit code is the only truth:
   ```bash
   gh pr checks "{pr-number}" --repo "$OWNER_REPO"
   ```
   Exit 0 and no `fail`/`pending` rows → green → Stage 4. Any `fail` row → fix round.
4. **Failure round** (repeat, max 3):
   1. List what failed: `gh pr checks "{pr-number}" --repo "$OWNER_REPO"` (nonzero exit rows).
   2. Pull the failing logs:

      ```bash
      gh run list --repo "$OWNER_REPO" --branch "$BRANCH" --limit 5 --json databaseId,workflowName,conclusion
      gh run view {run-id} --repo "$OWNER_REPO" --log-failed
      ```

   3. Diagnose from the shortest decisive error. Fix the product code or test — never the check itself.
   4. Commit the fix with specific paths and push:

      ```bash
      git add <paths> && git commit -m "fix({scope}): {what broke} ({change-id})" && git push
      ```

   5. Back to step 2. Rounds exhausted → stop: report each failing check with its decisive error line and leave the PR open for the user.
5. Typecheck/test failures that reproduce locally may be run locally first (`pnpm -r typecheck`, targeted vitest) to iterate faster than CI.

## Stage 4: Merge

Require: all checks green, working tree clean, fix rounds ≤ 3.

Confirm with the user (irreversible):

```text
All checks green. Merge PR #{pr-number} into $DEFAULT_BRANCH (merge commit)? [yes/no]
```

On yes — repo convention is merge commits (history: `Merge pull request #N`), and `--delete-branch` removes the remote and local branch, leaving you on the default branch:

```bash
gh pr merge "{pr-number}" --repo "$OWNER_REPO" --merge --delete-branch
```

Merge rejected (protection, conflicts, new commits behind): re-run the Stage 3 watch after any new push; a dirty merge state → report, do not force.

## Stage 5: Sync the default branch

```bash
git switch "$DEFAULT_BRANCH"
git pull --ff-only origin "$DEFAULT_BRANCH"
git remote prune origin
git branch -d "$BRANCH" 2>/dev/null || true
```

Verify the merge landed: `git log --oneline -3` shows the `Merge pull request #{pr-number}` commit at HEAD.

## Stage 6: Post-merge watch (report-only)

The merge push fires `deploy-staging.yml` (and the gated production deploy). Watch it and report; failures here are a follow-up for the user — do not start fixing master from this run:

```bash
gh run list --repo "$OWNER_REPO" --branch "$DEFAULT_BRANCH" --limit 3 --json databaseId,workflowName,status,conclusion
# when a run is still in progress:
gh run watch {run-id} --repo "$OWNER_REPO" --exit-status
```

## Final report

```text
Finish complete

  Change:        {change-id}
  PR:            {pr-url} (merged)
  CI rounds:     {0-3} fix round(s){, failing checks if stopped}
  Archive:       openspec/changes/archive/{YYYY-MM-DD-change-id}/
  $DEFAULT_BRANCH: synced at {short-sha}
  Post-merge:    {deploy-staging conclusion | not watched}
```

If stopped early: state the exact stage, what is done, what remains, and the decision needed.
