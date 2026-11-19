# claude-kit

내가 만든 Claude Code 스킬과 훅 모음입니다.

## 구성

### 스킬 (`skills/`)

| 이름 | 설명 |
| --- | --- |
| `washer-git-workflow` | 이슈 → 브랜치 → 커밋 → PR 규칙(`<이모지> :: <한글 설명>`)과 이슈·PR 템플릿. 커밋·PR에 Claude 표기를 남기지 않음 |
| `add-code` | 코드를 추가하기 전에 중복 코드를 찾고 위치·이름을 정하는 체크리스트 (Flutter / Riverpod 프로젝트용) |
| `flutter-contrib` | flutter/flutter 이슈를 내 fork에서 작업하는 순서(조사 → 계획 승인 → 로컬 커밋 → draft PR)와 Flutter 기여 규칙·AI 정책. `/flutter-contrib <이슈번호>`로 호출 |

### 훅 (`hooks/`)

| 이름 | 이벤트 | 설명 |
| --- | --- | --- |
| `washer-dart/format_dart.dart` | PostToolUse (Write/Edit) | Dart 파일에 `dart format` 적용 |
| `washer-dart/check_dart_conventions.dart` | PostToolUse (Write/Edit) | 파일명·위치·레이어 import·중복 선언 검사 |
| `washer-dart/check_module_readme.dart` | Stop | 모듈 구조가 바뀌었는데 README가 그대로면 확인 요청 |
| `flutter-contrib-guard/flutter-contrib-guard.js` | PreToolUse (Bash/Edit/Write) | Flutter 저장소에서만 작동하는 기여 규칙 가드. Git 규칙(master 직접 푸시·merge·force push 금지), PR 규칙(draft만, 이슈 링크·템플릿 필수), AI 정책(댓글·`gh pr ready` 금지), 코드 규칙(공백·라이선스·`dart format`·TODO 형식)을 어기면 차단하거나 확인을 요청. 사용자 전역(`~/.claude/hooks/`)에 설치 |

## 사용법

### 스킬

폴더를 `~/.claude/skills/`(전역) 또는 `<프로젝트>/.claude/skills/`(프로젝트용)에 복사합니다.

```bash
cp -r skills/washer-git-workflow ~/.claude/skills/
```

### 훅

1. 스크립트를 프로젝트의 `.claude/hooks/`에 복사합니다.
2. 같은 폴더의 `settings.snippet.json` 내용을 `.claude/settings.json`(팀 공용) 또는 `.claude/settings.local.json`(개인용)의 `hooks`에 합칩니다.

```bash
mkdir -p .claude/hooks
cp hooks/washer-dart/*.dart .claude/hooks/
```

훅 스크립트는 `$CLAUDE_PROJECT_DIR/.claude/hooks/`에 있다고 가정합니다. 위치를 바꾸면 snippet의 경로도 같이 바꿔야 합니다.

## 참고

- 훅은 Dart(`dart`)와 Node.js(`node`)가 설치되어 있어야 동작합니다.
- Washer 훅과 스킬은 Washer 앱의 폴더 구조(`lib/core`, `lib/features`, `lib/shared`)를 기준으로 작성되었습니다. 다른 프로젝트에서는 경로 규칙을 맞춰 수정해서 사용하세요.

### flutter-contrib-guard 설치

이 훅은 `~/.claude/hooks/`에 복사하고, `settings.snippet.json`을 `~/.claude/settings.json`의 `hooks`에 합칩니다. git remote 이름이 `flutter`인 저장소에서만 작동하고 다른 저장소에서는 아무것도 하지 않습니다.

```bash
mkdir -p ~/.claude/hooks
cp hooks/flutter-contrib-guard/flutter-contrib-guard.js ~/.claude/hooks/
```
