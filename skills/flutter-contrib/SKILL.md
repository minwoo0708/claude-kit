---
name: flutter-contrib
description: Work on a flutter/flutter issue from the user's fork following Flutter's contribution rules and the user's own workflow (investigate, plan, approval, local commit, draft PR). Use when the user says they want to work on, investigate or fix a Flutter issue or PR, or types /flutter-contrib <issue number>.
argument-hint: "<issue number or URL>"
---

# Flutter contribution workflow

Issue to work on: `$ARGUMENTS` (if empty, ask the user which issue and do nothing else).

Reply to the user in Korean.

## Environment

- Fork clone: `C:\Users\master\Documents\GitHub\flutter`. Remotes: `origin` = the user's fork (`minwoo0708/flutter`), `upstream` = `flutter/flutter`. Default branch: `master`.
- Work on ONE issue at a time in this shared folder. Before editing, run `git branch --show-current` and `git status`; stop and tell the user if the tree is dirty.
- Never touch, reset, rebase or force-push another issue's branch (for example `docs/accessibility-reduce-motion`, PR `#196954`).
- The user-level hook `~/.claude/hooks/flutter-contrib-guard.js` enforces Flutter's rules in this repo. If it blocks a command, explain why and do not work around it.

## Steps

1. **Investigate the issue.** Read the full issue thread. With `gh`, confirm that it has no assignee and no open or linked PR (also search `flutter/packages` and `flutter/website`). Report the result. If someone else is already on it, stop and say so.
2. **Verify from code.** Read the relevant code and base every factual claim on it. State plainly what could not be verified (device behavior, platforms not read).
3. **Plan, then wait.** Show the planned change and wait for the user's approval before editing any file.
4. **Branch and edit.** `git fetch upstream`, then `git switch -c <short-name> upstream/master`. Make the minimal change. For Dart files run `dart format --output=none --set-exit-if-changed <files>`.
5. **Commit locally.** The message needs a body that explains the problem and the fix, no `@mentions`, no "Reland", and ends with `Fixes #<issue>`. Do not push yet.
6. **Report** in Korean: what changed, what was verified, what was not.
7. **Push and PR only after the user approves.** Push to `origin` only. Open the PR with `gh pr create --draft`, using a body file built from `.github/PULL_REQUEST_TEMPLATE.md` (keep the template, the issue link and `Fixes #<issue>`).

## Rules from Flutter's contributor docs

- Docs-only (comment-only) changes are exempt from tests. Any other code change needs tests, and only reviewers can grant an exemption.
- Keep unrelated changes in separate PRs. Rebase onto `upstream/master`; never merge.
- Files must not end lines with spaces. New source files need the Flutter license header.
- Dartdoc: first paragraph is one short sentence; no "you" or "we"; no imperative voice (prefer "Consider ..."); never "simply" or "just"; no "Note:", "above" or "below"; end sentences with a period; use `[name]` for property references and add "See also:" breadcrumbs.
- TODOs look like `TODO(github-username): ... <issue link>`. A skipped test needs an issue link or `[intended]` on the same line.

## AI policy (CONTRIBUTING.ai.md)

- Do NOT post issue or PR comments, reviews or replies. Give the user a draft instead; the user posts it themselves.
- Do NOT run `gh pr ready` or merge. The user marks the PR ready after reviewing every change.
- Leave these PR checklist boxes UNCHECKED: "I read the Contributor Guide", "I read the AI contribution guidelines", "I read the Tree Hygiene", "I read and followed the Flutter Style Guide", and "All existing and new tests are passing". Only the user can attest to them, or CI results for tests.
- Do not create planning, notes or agent files in the repository.
- Verify every claim written in the PR description and never say feedback was addressed unless the change really was made.
