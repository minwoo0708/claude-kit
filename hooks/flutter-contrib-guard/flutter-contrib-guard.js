#!/usr/bin/env node
// Flutter contribution guard (PreToolUse). Local-only, never committed.
//
// Sources (all read in full): CONTRIBUTING.md, CONTRIBUTING.ai.md, CODE_OF_CONDUCT.md,
// docs/contributing/{Tree-hygiene,Style-guide-for-Flutter-repo,Signing-commits,
// Setting-up-the-Framework-development-environment,...}.md, engine/src/flutter/CONTRIBUTING.md
// and the rules in dev/bots/analyze.dart.
//
// Decisions: "deny"  = documented hard rule (or enforced by Flutter CI) -> blocked.
//            "ask"   = style guidance / judgment call -> the user is asked to confirm.
//
// Hooks cannot verify: CLA signature, reading the docs, understanding the code, RFC/design
// discussion, whether changes are "unrelated", reviewer behavior, Code of Conduct. See README
// section in the chat report for what is NOT enforced.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_OPEN_PRS = 2;
const PROTECTED = ['main', 'master'];
const UPSTREAM_BASES = ['upstream/master', 'upstream/main'];

let raw = '';
process.stdin.on('data', (d) => (raw += d)).on('end', main);

const deny = [];
const ask = [];

function finish() {
  const wrap = (label, items) =>
    `[flutter-guard] ${label}:\n` + items.map((i) => `  - ${i}`).join('\n');
  if (deny.length) {
    out('deny', wrap('BLOCKED' + (ask.length ? ' (also needs confirmation: see below)' : ''), deny) +
      (ask.length ? '\n' + wrap('NEEDS CONFIRMATION', ask) : ''));
  } else if (ask.length) {
    out('ask', wrap('PLEASE CONFIRM', ask));
  }
  process.exit(0);
}
function out(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
}
const D = (m) => deny.push(m);
const A = (m) => ask.push(m);

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}
function gitSafe(args, cwd) {
  try {
    return git(args, cwd).trim();
  } catch {
    return '';
  }
}

function isFlutterRepo(top) {
  const remotes = gitSafe(['remote', '-v'], top);
  return /[:/]flutter\/flutter(\.git)?(\s|$)/m.test(remotes) || /[:/][\w.-]+\/flutter(\.git)?(\s|$)/m.test(remotes);
}

function main() {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const tool = input.tool_name || '';
  const cwd = input.cwd || process.cwd();
  // User-level hook: act ONLY inside a Flutter clone (a remote named flutter, e.g.
  // flutter/flutter or <you>/flutter). The repo is decided per command segment (after any
  // `cd` or `git -C`) and per edited file, never from the session folder alone.
  if (tool === 'Bash') handleBash(input.tool_input || {}, cwd);
  else if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') handleEdit(tool, input.tool_input || {});
  finish();
}

// Convert Git-Bash style paths (/c/Users/x) to Windows style (C:/Users/x) and strip quotes.
function normPath(p, base) {
  let s = String(p).replace(/^["']|["']$/g, '');
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m) s = `${m[1]}:/${m[2]}`;
  return path.resolve(base || process.cwd(), s);
}

// Git top-level of the nearest existing directory at or above `p`, if it is a Flutter clone.
function flutterRootFor(p) {
  let dir = p;
  for (let i = 0; i < 30 && dir && !fs.existsSync(dir); i++) dir = path.dirname(dir);
  try { if (dir && fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch { return ''; }
  const top = gitSafe(['rev-parse', '--show-toplevel'], dir);
  return top && isFlutterRepo(top) ? top : '';
}

// ---------------------------------------------------------------- path helpers
const isCode = (p) => /\.(dart|cc|cpp|h|mm|m|java|kt|swift)$/.test(p);
const isTest = (p) => /(^|\/)(test|tests|test_fixes|testing)\/|_test\.(dart|cc|java|kt|swift|mm)$|Tests?\.(java|kt|swift)$/.test(p);
const inFrameworkLib = (p) => /^packages\/flutter\/lib\//.test(p);
const isThirdPartyOrGenerated = (p) => /(^|\/)third_party\/|\.g\.dart$|(^|\/)generated\/|gen_l10n|\.freezed\.dart$/.test(p);
const AI_ARTIFACT = /(^|\/)(CLAUDE|AGENTS|GEMINI|PLAN|PLANS|NOTES|TODO|SCRATCH|SUMMARY)[^/]*\.md$|(^|\/)\.(claude|cursor|aider|windsurf|codex|copilot)(\/|$)|(^|\/)(scratch|\.scratch|\.agent)/i;

// ---------------------------------------------------------------- line checks
function stripInlineCode(s) {
  return s.replace(/`[^`]*`/g, '``').replace(/\[[^\]]*\]/g, '[]');
}

// Checks lines being ADDED to `rel`. lines: [{n, text}]
function checkAddedLines(rel, lines) {
  if (!rel.endsWith('.dart') || isThirdPartyOrGenerated(rel)) return;
  const framework = inFrameworkLib(rel);
  const test = isTest(rel);
  const seen = new Set();
  const report = (kind, msg, ln) => {
    const key = kind + msg + (ln ? ln.n : '');
    if (seen.has(key)) return;
    seen.add(key);
    const where = ln ? `${rel}:${ln.n}: ` : `${rel}: `;
    (kind === 'deny' ? D : A)(where + msg);
  };
  let addedText = '';
  for (const ln of lines) {
    const t = ln.text;
    addedText += t + '\n';
    const trimmed = t.trim();
    const isLineComment = trimmed.startsWith('//');
    const isDoc = trimmed.startsWith('///');

    // dev/bots/analyze.dart: spaces after flow control statements
    if (!isLineComment && /(^|[^\w.$])(if|for|while|switch|catch)\(/.test(t)) {
      report('deny', 'needs a space after flow-control keyword, e.g. "if (" (CI: spaces-after-flow)', ln);
    }
    // Style guide: new in-body constructor syntax prohibited until May 2027
    if (/^\s*(const\s+)?new(\s+\w+)?\s*\(/.test(t)) {
      report('deny', 'new in-body constructor syntax (`new()`) is prohibited until May 2027 (style guide)', ln);
    }
    if (framework) {
      if (/\bclass\s+const\s+\w+\s*\(/.test(t)) {
        report('deny', 'primary constructors are not allowed for framework widgets (style guide)', ln);
      }
      if (!isLineComment && /(^|[^\w.$])print\(/.test(t)) {
        report('deny', 'avoid print() in framework code (style guide summary)', ln);
      }
      if (/^\s*part\s+of\b/.test(t)) report('ask', 'avoid `part of` (style guide)', ln);
      if (/^\s*library\s+\w+/.test(t)) report('ask', 'avoid naming a `library` unless it is a documented top-level library (style guide)', ln);
      if (!isLineComment && /\b(Future\.delayed|Timer(\.periodic)?|sleep)\(|\.timeout\(/.test(t)) {
        report('ask', 'avoid timers/timeouts/sleeps ("Never use timeouts or timers", style guide)', ln);
      }
    }
    // TODO format
    const todo = t.match(/\/\/.*\bTODO\b(.*)/);
    if (todo) {
      if (!/\bTODO\([A-Za-z0-9_-]+\):/.test(t)) {
        report('deny', 'TODO must look like `TODO(github-username): ...` (style guide)', ln);
      } else if (!/(https?:\/\/\S+|#\d+)/.test(t)) {
        report('ask', 'TODO should include an issue link (it may be on a following line)', ln);
      }
    }
    // ignores must be explained
    if (/\/\/\s*ignore(_for_file)?:\s*[\w, ]+\s*$/.test(t)) {
      report('ask', '`// ignore:` must have a bug link (temporary) or an explanation (permanent) (style guide)', ln);
    }
    // skipped tests need an issue link or [intended]
    if (/\bskip:\s*(?!false\b)[^,)]+/.test(t) && !/issues\/\d+|\[intended\]/.test(t)) {
      report('deny', 'skipped test needs a same-line issue link or `[intended]` comment (CI analyzer)', ln);
    }
    // comments that ask questions
    if (isLineComment && !isDoc && /\?\s*$/.test(trimmed) && !/https?:\/\//.test(trimmed)) {
      report('ask', 'avoid checking in comments that ask questions (style guide)', ln);
    }
    // dartdoc style
    if (isDoc) {
      const body = stripInlineCode(trimmed.replace(/^\/\/\/\s?/, ''));
      if (/\b(you|we|your|our)\b/i.test(body)) report('ask', 'dartdoc: never use "you"/"we" (style guide)', ln);
      if (/\b(simply|just|easy|easily|obviously)\b/i.test(body)) report('ask', 'dartdoc: never say things are simple / "just" / "simply" (style guide)', ln);
      if (/\bNote(:| that)\b/.test(body)) report('ask', 'dartdoc: avoid "Note:" / "Note that" (empty prose, style guide)', ln);
      if (/\b(above|below)\b/i.test(body)) report('ask', 'dartdoc: avoid "above"/"below" references (style guide)', ln);
      if (/^(Use|Check|Set|Make|Avoid|Ensure|Call|Pass|Add|Remove)\b/.test(body.trim())) {
        report('ask', 'dartdoc: avoid the imperative voice; prefer "Consider ..." (style guide)', ln);
      }
    }
  }
  // Deprecation syntax
  if (/@Deprecated\(/.test(addedText) && !/This feature was deprecated after v/.test(addedText)) {
    A(`${rel}: @Deprecated must follow the standard form ending with "This feature was deprecated after v<beta version>." and link a migration guide (Tree hygiene)`);
  }
}

function licenseOk(content, rel) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const prefix = /\.(py|gn|gni|sh|yaml|yml)$/.test(rel) ? '# ' : '// ';
  return (
    lines[0] !== undefined &&
    new RegExp('^' + prefix.replace(/[/#]/g, '\\$&') + 'Copyright (2013|2014) The Flutter Authors\\. All rights reserved\\.$').test(lines[0]) &&
    (lines[1] || '').includes('Use of this source code is governed by a BSD-style license that can be')
  );
}

// ---------------------------------------------------------------- Edit / Write
function handleEdit(tool, ti) {
  if (!ti.file_path) return;
  const file = normPath(ti.file_path);
  const root = flutterRootFor(file);
  if (!root) return; // not a Flutter clone: do nothing
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return; // outside the repo
  if (rel.startsWith('.claude/hooks/') || rel === '.claude/settings.local.json') return;

  if (AI_ARTIFACT.test(rel)) {
    A(`${rel}: looks like an agent planning/notes file. AI policy: do not include such files in a PR (CONTRIBUTING.ai.md). Keep it out of the repo or untracked.`);
  }

  let oldText = '';
  try { oldText = fs.readFileSync(file, 'utf8'); } catch {}
  const exists = oldText !== '' || fs.existsSync(file);

  let addedLines = [];
  const linesOf = (s) => s.split('\n');
  const diffLines = (newS, oldS) => {
    const old = new Set(linesOf(oldS));
    return linesOf(newS).map((text, i) => ({ n: i + 1, text })).filter((l) => !old.has(l.text));
  };
  if (tool === 'Write') {
    const content = ti.content || '';
    addedLines = diffLines(content, oldText);
    if (!exists && /\.(dart|cc|cpp|h|mm|java|kt)$/.test(rel) && !isThirdPartyOrGenerated(rel) && !licenseOk(content, rel)) {
      D(`${rel}: new source file must start with the Flutter license header ("// Copyright 2014 The Flutter Authors. All rights reserved." + BSD line) (CI: no-missing-license)`);
    }
  } else if (tool === 'Edit') {
    addedLines = diffLines(ti.new_string || '', ti.old_string || '');
  } else if (tool === 'MultiEdit') {
    for (const e of ti.edits || []) addedLines.push(...diffLines(e.new_string || '', e.old_string || ''));
  }
  // trailing whitespace / tabs (CI: no-trailing-spaces)
  for (const ln of addedLines) {
    if (/[ \t]+$/.test(ln.text) && ln.text.trim() !== '' || /^[ \t]+$/.test(ln.text)) {
      D(`${rel}: trailing whitespace in added text (CI: no-trailing-spaces)`);
      break;
    }
  }
  checkAddedLines(rel, addedLines);
}

// ---------------------------------------------------------------- Bash
function handleBash(ti, cwd) {
  const cmd = ti.command || '';
  const segments = cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
  let eff = cwd; // effective directory, updated by `cd`
  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    if (tokens[0] === 'cd' && tokens[1]) { eff = normPath(tokens[1], eff); continue; }
    let segCwd = eff;
    if (tokens[0] === 'git') {
      const ci = tokens.indexOf('-C');
      if (ci > 0 && tokens[ci + 1]) segCwd = normPath(tokens[ci + 1], eff);
    }
    if (tokens[0] !== 'gh' && tokens[0] !== 'git') continue;
    const root = flutterRootFor(segCwd);
    if (!root) continue; // this segment runs outside a Flutter clone: do nothing
    if (tokens[0] === 'gh') ghCommand(tokens, cmd, seg, root);
    if (tokens[0] === 'git') gitCommand(tokens, cmd, root);
  }
}

function gitSub(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-C' || t === '-c') { i++; continue; }
    if (t.startsWith('-')) continue;
    return { sub: t, idx: i };
  }
  return { sub: '', idx: -1 };
}

function currentBranch(cwd) {
  return gitSafe(['branch', '--show-current'], cwd);
}

function gitCommand(tokens, fullCmd, cwd) {
  const { sub, idx } = gitSub(tokens);
  const args = idx >= 0 ? tokens.slice(idx + 1) : [];
  if (sub === 'commit') checkCommit(args, fullCmd, cwd);
  else if (sub === 'push') checkPush(args, cwd);
  else if (sub === 'merge') {
    if (!args.some((a) => ['--abort', '--quit', '--continue'].includes(a))) {
      D('use rebase, not merge: `git fetch upstream && git rebase upstream/master` (Tree hygiene: "Using git")');
    }
  } else if (sub === 'pull') {
    if (!args.some((a) => a === '--rebase' || a === '-r' || a === '--ff-only' || a.startsWith('--rebase='))) {
      D('use `git fetch` + `git rebase` or `git pull --rebase`, not a merge pull (Tree hygiene: "Using git")');
    }
  }
}

function checkPush(args, cwd) {
  const branch = currentBranch(cwd);
  const positional = args.filter((t) => !t.startsWith('-'));
  if (args.some((t) => t === '--force' || t === '-f' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t))) {
    D('plain force push is blocked; use --force-with-lease and be wary with golden tests (Tree hygiene)');
  }
  if (positional[0] === 'upstream') D("do not push to 'upstream' (flutter/flutter); push to 'origin' (your fork)");
  const toProtected = positional.slice(1).some((t) => PROTECTED.includes(t.includes(':') ? t.split(':').pop() : t));
  if (toProtected || (positional.length <= 1 && PROTECTED.includes(branch))) {
    D(`pushing to ${PROTECTED.join('/')} is blocked; push a feature branch and open a PR from your fork`);
  }
  // merge commits on the branch -> rebase policy
  for (const base of UPSTREAM_BASES) {
    if (!gitSafe(['rev-parse', '--verify', '-q', base], cwd)) continue;
    const merges = gitSafe(['rev-list', '--merges', `${base}..HEAD`], cwd);
    if (merges) D(`branch contains merge commits (${merges.split('\n').length}); rebase onto ${base} instead of merging (Tree hygiene)`);
    break;
  }
}

function commitMessage(cmd, cwd) {
  const parts = [];
  const hd = cmd.match(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/);
  if (hd) parts.push(hd[2]);
  const re = /(?:^|\s)(?:-m|--message)[ =]?(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(cmd))) parts.push(m[1] ?? m[2]);
  const f = cmd.match(/(?:-F|--file)[ =]+["']?([^\s"']+)/);
  if (f && f[1] !== '-') {
    try { parts.push(fs.readFileSync(path.resolve(cwd, f[1]), 'utf8')); } catch {}
  }
  return parts.length ? parts.join('\n\n') : null;
}

function checkCommit(args, fullCmd, cwd) {
  const branch = currentBranch(cwd);
  if (PROTECTED.includes(branch)) D(`you are on '${branch}'; create a feature branch first (git switch -c <name>) from upstream`);

  const all = args.includes('-a') || args.includes('--all') || args.some((a) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a) && !a.startsWith('--'));
  const diffArgs = all ? ['diff', 'HEAD'] : ['diff', '--cached'];

  // Whitespace (CI: no-trailing-spaces, trailing blank line)
  try {
    git([...diffArgs, '--check'], cwd);
  } catch (e) {
    const o = String(e.stdout || '').trim().split('\n').slice(0, 4).join(' | ');
    if (e.status === 2 && o) D(`whitespace errors (trailing spaces/tabs, blank line at EOF; Tree hygiene says files must not have trailing spaces): ${o}`);
  }

  const diffText = gitSafe([...diffArgs, '-U0', '--no-color', '--no-ext-diff'], cwd);
  const files = parseDiff(diffText).filter((f) => f.path);

  // AI artifacts / planning files
  for (const f of files) {
    if (f.isDeleted) continue;
    if (AI_ARTIFACT.test(f.path)) D(`${f.path}: agent planning/notes/config files must not be committed (AI policy: irrelevant AI-generated files are grounds for closing the PR)`);
    if (f.isNew && /^[^/]+\.md$/.test(f.path)) A(`${f.path}: new Markdown file at repo root; make sure it is intentional and human-written`);
  }

  // Per-file checks
  let needsTests = false;
  let touchesTests = files.some((f) => isTest(f.path));
  for (const f of files) {
    if (f.isDeleted) continue;
    checkAddedLines(f.path, f.added);
    if (f.isNew && /\.(dart|cc|cpp|h|mm|java|kt)$/.test(f.path) && !isThirdPartyOrGenerated(f.path)) {
      let content = '';
      try { content = fs.readFileSync(path.resolve(cwd, f.path), 'utf8'); } catch {}
      if (!licenseOk(content, f.path)) D(`${f.path}: new source file must start with the Flutter license header (CI: no-missing-license)`);
    }
  }
  for (const f of files) {
    if (!isCode(f.path) || isTest(f.path) || /^\.github\//.test(f.path)) continue;
    const real = [...f.added.map((l) => l.text), ...f.removed].filter((t) => t.trim() && !t.trim().startsWith('//'));
    if (real.length) needsTests = true;
  }
  if (needsTests && !touchesTests) {
    A('code changes without any test changes. Every change needs tests unless it only touches comments/docs/.md/.github (Tree hygiene "Tests"); exemptions are granted by reviewers/tech leads, not by you');
  }

  // Unrelated changes
  const areas = new Set(files.map((f) => f.path.split('/').slice(0, 3).join('/')));
  if (areas.size > 6) A(`commit touches ${areas.size} different areas; put unrelated changes in separate PRs (Tree hygiene)`);

  // Format (Dart)
  const dartFiles = files.filter((f) => !f.isDeleted && f.path.endsWith('.dart')).map((f) => f.path);
  if (dartFiles.length) {
    try {
      execFileSync('dart', ['format', '--output=none', '--set-exit-if-changed', ...dartFiles], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    } catch (e) {
      if (e.status === 1) D(`staged Dart files are not dart-formatted; run: dart format ${dartFiles.join(' ')}`);
      else A('could not run `dart format` to verify formatting');
    }
  }
  // Engine C/ObjC formatting
  const cFiles = files.filter((f) => !f.isDeleted && /^engine\/.*\.(cc|cpp|h|mm|m)$/.test(f.path));
  if (cFiles.length) A(`engine C/C++/ObjC files changed (${cFiles.length}); format them with buildtools/<OS>/clang/bin/clang-format --style=file -i (Tree hygiene) - this hook cannot verify it`);

  // Commit message
  const msg = commitMessage(fullCmd, cwd);
  if (msg !== null) {
    const lines = msg.split('\n').map((l) => l.trimEnd());
    const subject = lines[0] || '';
    const body = lines.slice(1).filter((l) => l.trim() && !/^(fixes|closes|resolves)\s/i.test(l.trim()));
    if (body.length === 0) D('commit message needs a body explaining what the problem was and what the solution is (Tree hygiene: "detailed commit messages")');
    if (/(^|[\s(])@[A-Za-z0-9_-]+/.test(msg)) D('no GitHub @-mentions in commit messages; mention people in a PR comment instead (Tree hygiene)');
    if (/\breland\b/i.test(subject)) D('avoid "Reland" in commit messages; re-land with the original message plus links to the original and revert PRs (Tree hygiene)');
    if ((subject.match(/\bRevert\b/g) || []).length > 1) D('only one "Revert" per commit message (Tree hygiene)');
    if (subject.length > 100) A('commit subject is very long');
  }
}

function parseDiff(text) {
  const files = [];
  let cur = null;
  let inHunk = false;
  let newLine = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', isNew: false, isDeleted: false, added: [], removed: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.isNew = true;
      else if (line.startsWith('deleted file mode')) cur.isDeleted = true;
      else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null') cur.path = p.replace(/^b\//, ''); }
      else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null' && !cur.path) cur.path = p.replace(/^a\//, ''); }
      else if (line.startsWith('@@')) { inHunk = true; const m = line.match(/\+(\d+)/); newLine = parseInt(m[1], 10); }
      continue;
    }
    if (line.startsWith('@@')) { const m = line.match(/\+(\d+)/); newLine = parseInt(m[1], 10); }
    else if (line.startsWith('+')) cur.added.push({ n: newLine++, text: line.slice(1) });
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return files;
}

// ---------------------------------------------------------------- gh
function ghCommand(tokens, fullCmd, seg, cwd) {
  const verb = `${tokens[1] || ''} ${tokens[2] || ''}`.trim();
  const AI_MSG = '(AI policy: do not use AI to substitute for human discussion; the user posts this themselves)';
  switch (verb) {
    case 'pr create': return checkPrCreate(fullCmd, seg, cwd);
    case 'pr ready': return D(`do not mark the PR "Ready for review": the human must first review all AI-generated code and the PR text (CONTRIBUTING.ai.md, "Pull requests")`);
    case 'pr comment': case 'pr review': case 'issue comment': case 'issue create':
      return D(`posting ${verb} is blocked ${AI_MSG}`);
    case 'pr merge': return D('merging is for maintainers; contributors without write access cannot and should not');
    case 'pr edit': case 'issue edit': case 'pr close': case 'issue close':
      return A(`${verb} changes public content; any AI-written text must be verified by the user first (CONTRIBUTING.ai.md)`);
  }
  if (tokens[1] === 'api') {
    const mut = /(^|\s)(-X|--method)[ =]?(POST|PUT|PATCH|DELETE)\b/i.test(seg) || /(^|\s)(-f|-F|--field|--raw-field|--input)\b/.test(seg);
    if (mut) A('gh api with a write method changes public data; confirm it is user-approved, not AI-authored discussion');
  }
}

function checkPrCreate(fullCmd, seg, cwd) {
  const isDraft = /(^|\s)(--draft|-d)(\s|$)/.test(seg);
  if (!isDraft) {
    D('open PRs as --draft only; the user marks them Ready after reviewing every AI-generated change and the PR description (CONTRIBUTING.ai.md: "You must review all AI-generated code before opening a (non-draft) PR")');
  }
  // Concurrent PR limit (draft PRs are exempt)
  if (!isDraft) {
    try {
      const n = parseInt(
        execFileSync('gh', ['pr', 'list', '-R', 'flutter/flutter', '--author', '@me', '--state', 'open', '--json', 'isDraft', '--jq', '[.[]|select(.isDraft|not)]|length'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true }).trim(), 10);
      if (!Number.isNaN(n) && n >= MAX_OPEN_PRS) D(`you already have ${n} open non-draft PRs in flutter/flutter (limit ${MAX_OPEN_PRS})`);
    } catch {
      A('could not check the open-PR limit (gh failed)');
    }
  }
  // Body: from --body-file or inline
  let text = fullCmd;
  const bf = fullCmd.match(/(?:--body-file|-F)[ =]+["']?([^\s"']+)/);
  if (bf && bf[1] !== '-') {
    try { text += '\n' + fs.readFileSync(path.resolve(cwd, bf[1]), 'utf8'); } catch {}
  } else if (!/(--body|-b)\b/.test(fullCmd)) {
    D('PR needs a body based on the repo PR template (do not use --fill or an empty body)');
  }
  // Template must be kept (AI red flag: template replaced)
  if (!/##\s*Pre-launch Checklist/i.test(text)) D('PR body must keep the repository PR template, including "## Pre-launch Checklist" (CONTRIBUTING.ai.md reviewer red flags)');
  // Issue link
  const issueRef = /(fix(es|ed)?|close[sd]?|resolve[sd]?|part of|related to)\s+(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/|[\w.-]+\/[\w.-]+#|#)\d+/i;
  if (!issueRef.test(text) && !/NO-ISSUE:/i.test(text)) D('PR body must link at least one issue (e.g. "Fixes #123"); trivial typo fixes may add "NO-ISSUE: <reason>"');
  // Attestations only the human can make
  const attest = [
    [/^- \[[xX]\] I read the \[?Contributor Guide/m, 'Contributor Guide'],
    [/^- \[[xX]\] I read the \[?AI contribution guidelines/m, 'AI contribution guidelines'],
    [/^- \[[xX]\] I read the \[?Tree Hygiene/im, 'Tree Hygiene'],
    [/^- \[[xX]\] I read and followed the \[?Flutter Style Guide/m, 'Flutter Style Guide'],
    [/^- \[[xX]\] All existing and new tests are passing/m, 'tests passing'],
  ];
  for (const [re, name] of attest) {
    if (re.test(text)) D(`leave the "${name}" checklist box unchecked; only the human author can attest to it (or CI results for tests)`);
  }
  // Branch checks
  const branch = currentBranch(cwd);
  if (PROTECTED.includes(branch)) D(`PR must come from a feature branch, not '${branch}'`);
}
