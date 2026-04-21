
<img width="2752" height="1536" alt="말랑말랑 멀티 모델 터미널 가이드" src="https://github.com/user-attachments/assets/cfd3b3e1-e324-4404-a3bf-28d3e266cdf5" />


# Multi Model TUI

`Codex / Claude / Gemini`를 하나의 터미널 REPL과 로컬 프록시로 묶은 단일 패키지입니다.

## 구조

- `TUI`는 localhost 프록시만 호출합니다.
- `Proxy`는 통합 JSON API와 Anthropic/OpenAI 호환 API를 제공합니다.
- `Codex`는 direct backend transport를 사용합니다.
- `Claude`, `Gemini`는 direct transport 우선, 실패 시 CLI fallback을 사용합니다.

## 명령

- `/codex <prompt>`
- `/gemini <prompt>`
- `/claude <prompt>`
- `/all <prompt>`
- `/status`
- `/self-test`
- `/help`
- `/exit`

## 인증 소스

- Codex: `~/.codex/auth.json`, fallback `~/.chatgpt-codex-proxy/tokens.json`
- Gemini: `~/.gemini/oauth_creds.json`
- Claude direct: `CLAUDE_CODE_OAUTH_TOKEN`
- Claude fallback: 로컬 `claude` CLI
- Gemini fallback: 로컬 `gemini` CLI

## 실행

```bash
npm install
npm run dev
```

개별 실행:

```bash
npm run dev:proxy
npm run dev:tui
```

빌드 후 실행:

```bash
npm run build
npm run start
```

## 프록시 엔드포인트

- `GET /api/v1/health`
- `GET /api/v1/providers`
- `POST /api/v1/chat`
- `POST /api/v1/batch`
- `POST /api/v1/chat/stream`
- `POST /api/v1/batch/stream`
- `POST /api/v1/self-test`
- `GET /api/v2/capabilities`
- `GET /api/v2/capabilities/:provider`
- `POST /api/v2/chat`
- `POST /api/v2/batch`
- `POST /api/v2/chat/stream`
- `POST /api/v2/batch/stream`
- `POST /anthropic/v1/messages`
- `POST /openai/v1/chat/completions`
- `POST /openai/v1/responses`

## v2 정형화 범위

- 공통 코어: `messages[]`, `system/developer`, `stream`, `usage`, `finishReason`
- 공통 확장: `tool_call`, `tool_result`, `structured output`, `image/file part`, `reasoning/citation/state`
- capability matrix: provider별 `platform / transport / effective` 지원 강도를 `/api/v2/capabilities`로 확인 가능
- CLI fallback: `Claude CLI`, `Gemini CLI`는 `text/core-only`로 제한되며 고급 기능 요청 시 `unsupported_feature` 에러를 반환
- hosted tools:
  - `Claude API`는 `web_search`, `code_execution`을 실제 요청 body로 전달합니다.
  - `Codex direct`, `Gemini Code Assist`, CLI fallback은 hosted tools를 아직 지원하지 않거나 `unverified` 상태입니다.
- tool history:
  - `Claude API`, `Codex direct`는 `tool_call`, `tool_result` 이력을 입력 메시지에 다시 실어 보냅니다.
- compatibility streaming:
  - `Anthropic/OpenAI` 호환 스트리밍도 이제 `tool_call`과 `usage/finishReason` 메타를 함께 내보냅니다.

## 휴먼 입력 전략

- `computer_use`, `remote_mcp` 같은 interactive hosted tool은 자동 실행하지 않습니다.
- `humanInputMode: "return"`를 주면 프록시는 `human_input_required` 에러와 함께 `humanInput` payload를 반환합니다.
- 이 payload는 `title`, `instructions`, `toolType`, `resumable`을 포함합니다.
- 현재 버전은 승인 요청을 "반환"까지만 지원하고, 승인 후 이어서 자동 resume 하지는 않습니다.
- `humanInputMode`가 없거나 `"forbid"`이면 동일 상황에서 fail-fast 합니다.

## 비고

- `v1`은 기존 text-first 호환 레이어로 유지됩니다.
- `v2`는 rich contract 기반입니다. 다만 hosted tools, files, citations, caching 일부는 provider/transport별 `partial` 또는 `unverified` 상태입니다.
- 설계 문서: [docs/local-proxy-refactor-design.md](/Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/docs/local-proxy-refactor-design.md)
