#!/usr/bin/env node
// Flutter contribution guard (PreToolUse / Bash). Local-only, not committed.
// Blocks (exit 2 + message on stderr) commands that break Flutter's contribution rules:
//   1. `gh pr create` when you already have 2 open non-draft PRs (unless --draft)
//   2. `gh pr create` without a linked issue (Fixes #123 ...). Escape hatch: write "NO-ISSUE: <reason>"
//   3. git commit / push while on main or master, or pushing to `upstream`
//   4. git merge / `git pull` without --rebase (Flutter wants rebase)
//   5. plain `git push --force` (use --force-with-lease)
//   6. git commit with staged .dart files that are not `dart format`-clean

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');

const MAX_OPEN_PRS = 2;
const PROTECTED = ['main', 'master'];

let raw = '';
process.stdin.on('data', (d) => (raw += d)).on('end', main);

function block(msg) {
  process.stderr.write(`[flutter-guard] BLOCKED: ${msg}\n`);
  process.exit(2);
}
function warn(msg) {
  process.stderr.write(`[flutter-guard] warning: ${msg}\n`);
}
function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  const cmd = (input.tool_input && input.tool_input.command) || '';
  const cwd = input.cwd || process.cwd();

  // Split a compound command into segments (&&, ||, ;, |, newline).
  const segments = cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    if (tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'create') checkPrCreate(cmd, seg, cwd);
    if (tokens[0] !== 'git') continue;
    const sub = tokens.slice(1).find((t) => !t.startsWith('-') && t !== cwd) || '';
    if (sub === 'commit') checkCommit(cwd);
    if (sub === 'push') checkPush(tokens, cwd);
    if (sub === 'merge') checkMerge(tokens);
    if (sub === 'pull') checkPull(tokens);
  }
  process.exit(0);
}

function currentBranch(cwd) {
  try {
    return sh('git branch --show-current', cwd);
  } catch {
    return '';
  }
}

function checkPrCreate(fullCmd, seg, cwd) {
  // (1) concurrent PR limit
  const isDraft = /(^|\s)(--draft|-d)(\s|$)/.test(seg);
  if (!isDraft) {
    try {
      const out = sh(
        "gh pr list -R flutter/flutter --author @me --state open --json isDraft --jq \"[.[]|select(.isDraft|not)]|length\"",
        cwd
      );
      const n = parseInt(out, 10);
      if (!Number.isNaN(n) && n >= MAX_OPEN_PRS) {
        block(
          `You already have ${n} open non-draft PRs in flutter/flutter (limit ${MAX_OPEN_PRS}). ` +
            'Merge/close one first, or open this one with --draft.'
        );
      }
    } catch (e) {
      warn('could not check open PR count (gh failed); skipping the limit check.');
    }
  }

  // (2) linked issue required
  let text = fullCmd;
  const m = fullCmd.match(/(?:--body-file|-F)[ =]+["']?([^\s"']+)/);
  if (m && m[1] !== '-') {
    try {
      text += '\n' + fs.readFileSync(m[1], 'utf8');
    } catch {}
  }
  const issueRef =
    /(fix(es|ed)?|close[sd]?|resolve[sd]?|part of|related to)\s+(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/|[\w.-]+\/[\w.-]+#|#)\d+/i;
  const exempt = /NO-ISSUE:/i;
  if (!issueRef.test(text) && !exempt.test(text)) {
    block(
      'PR body must link at least one issue, e.g. "Fixes #196602" or "Part of flutter/flutter#123". ' +
        'For a trivial typo fix, add a line "NO-ISSUE: <reason>".'
    );
  }
}

function checkCommit(cwd) {
  const branch = currentBranch(cwd);
  if (PROTECTED.includes(branch)) {
    block(`You are on '${branch}'. Create a feature branch first (git switch -c <name>).`);
  }
  // (6) dart format check on staged files
  try {
    const files = sh('git diff --cached --name-only --diff-filter=ACM', cwd)
      .split('\n')
      .filter((f) => f.endsWith('.dart'));
    if (files.length === 0) return;
    try {
      execFileSync('dart', ['format', '--output=none', '--set-exit-code', ...files], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } catch (e) {
      if (e.status === 1) {
        block(`These staged files are not dart-formatted. Run: dart format ${files.join(' ')}`);
      }
      warn('dart format check could not run; skipping.');
    }
  } catch {
    /* no staged files or not a git repo */
  }
}

function checkPush(tokens, cwd) {
  const args = tokens.slice(2);
  const branch = currentBranch(cwd);
  const positional = args.filter((t) => !t.startsWith('-'));
  // (5) plain force
  if (args.some((t) => t === '--force' || t === '-f' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t))) {
    block('Plain force push is blocked. Use --force-with-lease instead (and be careful with golden tests).');
  }
  // (3) never push to upstream or to main/master
  if (positional[0] === 'upstream') block("Do not push to 'upstream' (flutter/flutter). Push to 'origin' (your fork).");
  const targetsProtected = positional.slice(1).some((t) => {
    const dst = t.includes(':') ? t.split(':').pop() : t;
    return PROTECTED.includes(dst);
  });
  if (targetsProtected || (positional.length <= 1 && PROTECTED.includes(branch))) {
    block(`Pushing to ${PROTECTED.join('/')} is blocked. Push a feature branch and open a PR.`);
  }
}

function checkMerge(tokens) {
  if (tokens.includes('--abort') || tokens.includes('--quit') || tokens.includes('--continue')) return;
  block('Flutter asks for rebase, not merge. Use: git fetch upstream && git rebase upstream/master (or main).');
}

function checkPull(tokens) {
  if (tokens.some((t) => t === '--rebase' || t === '-r' || t === '--ff-only' || t.startsWith('--rebase='))) return;
  block('Use "git pull --rebase" (or git fetch + git rebase) instead of a merge pull.');
}
