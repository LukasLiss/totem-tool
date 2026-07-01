# Git & PR Guide

How we use Git, branches, and pull requests on this repo. Read this once before your first PR.

## TL;DR

- One **epic branch** per epic issue, branched from `main`.
- One **sub-branch** per sub-issue, branched from its epic branch.
- Sub-PRs merge into the epic branch — does not require a review.
- When the epic is complete, one PR from the epic branch into `main` — this PR **requires a review**.
- Every PR body contains `Closes #<issue-number>` so the linked issue closes automatically on merge.

```
main
 └── epic/127-dotted-chart            ← epic branch (one PR to main at the end, review required)
      ├── epic/127/128-sampling-endpoint   ← sub-branch (PR into epic branch, self-merge OK)
      ├── epic/127/129-core-component
      └── epic/127/130-config-ui
```

## Branch naming

Use lowercase, hyphen-separated slugs. Keep slugs short (3–5 words).

| Type | Pattern | Example |
|---|---|---|
| Epic | `epic/<epic-number>-<slug>` | `epic/127-dotted-chart` |
| Sub-issue | `epic/<epic-number>/<sub-number>-<slug>` | `epic/127/128-sampling-endpoint` |
| Standalone (no epic) | `issue/<number>-<slug>` | `issue/145-fix-jwt-expiry` |
| Quick fix, no issue | `chore/<slug>` or `fix/<slug>` | `chore/bump-duckdb` |

The shared `epic/127/...` prefix makes the parent–child relationship visible in `git branch`, GitHub's branch picker, and `gh pr list`.

## Workflow

### 1. Start of an epic

The maintainer creates the epic branch from `main` and pushes it:

```bash
git checkout main && git pull
git checkout -b epic/127-dotted-chart
git push -u origin epic/127-dotted-chart
```

### 2. Work on a sub-issue

Branch from the **epic branch**, not from `main`:

```bash
git checkout epic/127-dotted-chart && git pull
git checkout -b epic/127/128-sampling-endpoint
# ... commit your work ...
git push -u origin epic/127/128-sampling-endpoint
```

Commit often. Small, focused commits make review easier if you decide to request one. Commit messages: short imperative subject line ("Add sampling endpoint"), optional body for the why.

### 3. Open a sub-PR

Open the PR with the **epic branch as the base** (not `main`):

```bash
gh pr create --base epic/127-dotted-chart --fill
```

In the PR body, include `Closes #128` so the sub-issue closes when the PR is merged. This is what makes the sub-issue tick off in the epic's sub-issues panel and on the project board.

**Reviews on sub-PRs are optional.** Request one (`gh pr edit --add-reviewer <user>`) if:

- You're unsure about an approach.
- The change touches an unfamiliar area or a layer boundary (e.g. `totem_lib` ↔ backend).
- Something feels risky.

Otherwise self-merge once CI is green.

You can use **"Squash and merge"** for sub-PRs. The epic branch stays linear and each sub-issue shows up as one commit.

### 4. Keep the sub-branch fresh

If the epic branch advances while you're working (other sub-PRs landed), rebase onto it:

```bash
git checkout epic/127/128-sampling-endpoint
git fetch origin
git rebase origin/epic/127-dotted-chart
git push --force-with-lease
```

Use `--force-with-lease`, never `--force` — it refuses to overwrite work someone else pushed.

### 5. Close the epic

When every sub-issue is merged, open one PR from the epic branch to `main`:

```bash
gh pr create --base main --head epic/127-dotted-chart
```

This PR body should include `Closes #127` (the epic issue).

**A review is required by branch protection.** Wait for approval before merging. Use **"Merge commit"** (not squash) so the individual sub-issue commits stay in `main`'s history.

After merge, delete the epic branch.

## Pull request checklist

The PR template prompts for these — fill them in:

- **Summary**: 1–3 bullets on what changes and why.
- **Linked issue**: `Closes #<num>`. One per PR.
- **Test plan**: how you verified it. Commands, manual steps, screenshots for UI.
- **Screenshots**: before/after for any visible change.

Keep PRs small. If a sub-issue grows beyond ~500 changed lines, ask whether it should be split.

## Conventions

- **Don't push to `main`.** Always go through a PR.
- **Don't push to someone else's branch** without asking.
- **Don't merge your own epic→main PR** without an approval, even if you have the button.
- **One sub-issue per PR**, one `Closes #` per PR. Bundling makes the project board lie.
- **CI must pass** before merging. If it's flaky, fix the flake or flag it — don't merge red.
- **Delete branches after merge.** GitHub offers this in the merge dialog.

## When something goes wrong

- **Accidentally branched from `main` instead of the epic?** Rebase: `git rebase --onto epic/127-dotted-chart main your-branch`.
- **Merged into the wrong base?** Don't try to "un-merge." Open a follow-up PR that reverts and re-applies on the right base, and ping a maintainer.
- **Force-push wiped your work?** `git reflog` shows your recent commits — you can usually recover.

When in doubt, ask before pushing.
