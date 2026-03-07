# Multi-Model-TUI 프로젝트 분석 보고서

## 1. 프로젝트 개요

**Codex / Claude / Gemini** 3개의 AI 모델을 **하나의 터미널 REPL**과 **로컬 프록시 서버**로 통합한 TypeScript 패키지입니다.

핵심 아키텍처:

```text
TUI Client (REPL)
  → localhost HTTP
    → Local Proxy (Express)
      → Provider Adapter
        → Direct Transport 또는 CLI Fallback
```

| 항목 | 값 |
|---|---|
| 언어 | TypeScript (ES2023, NodeNext) |
| 런타임 | Node.js ≥ 24.0.0 |
| 프레임워크 | Express 5, dotenv, chalk, google-auth-library |
| 빌드 | `tsc` → `dist/` |
| 개발 실행 | `tsx` (dev hot-reload) |

---

## 2. 디렉터리 구조

```text
multi-model-tui/
├── src/
│   ├── bin/                    # 엔트리포인트 (dev, proxy, tui)
│   ├── tui/                    # TUI 클라이언트 레이어
│   │   ├── repl.ts             # REPL 루프
│   │   ├── client.ts           # 프록시 HTTP 클라이언트
│   │   ├── parser.ts           # 명령어 파서
│   │   └── format.ts           # 결과 포매터
│   ├── proxy/                  # 로컬 프록시 서버
│   │   ├── server.ts           # Express 서버 부트스트랩
│   │   ├── router.ts           # Provider 라우팅 + Policy
│   │   ├── contracts.ts        # v2 API 계약 (15KB)
│   │   ├── routes-unified.ts   # v1/v2 통합 라우트
│   │   ├── routes-anthropic.ts # Anthropic 호환 라우트
│   │   ├── routes-openai.ts    # OpenAI 호환 라우트
│   │   ├── routes-health.ts    # 헬스체크 라우트
│   │   ├── mapper-anthropic.ts # Anthropic ↔ Normalized 매핑
│   │   ├── mapper-openai.ts    # OpenAI ↔ Normalized 매핑
│   │   ├── status.ts           # Provider 상태 관리
│   │   └── self-test.ts        # 스모크 테스트
│   ├── providers/              # Provider 구현
│   │   ├── base.ts             # 공통 추상 클래스
│   │   ├── codex/              # Codex (Direct only)
│   │   │   ├── adapter.ts
│   │   │   ├── transport-direct.ts (14KB)
│   │   │   ├── auth.ts
│   │   │   └── types.ts
│   │   ├── claude/             # Claude (API + CLI)
│   │   │   ├── adapter.ts
│   │   │   ├── transport-api.ts (17KB)
│   │   │   ├── transport-cli.ts
│   │   │   └── types.ts
│   │   └── gemini/             # Gemini (Code Assist + CLI)
│   │       ├── adapter.ts
│   │       ├── transport-code-assist.ts (17KB)
│   │       ├── transport-cli.ts
│   │       ├── auth.ts
│   │       └── types.ts
│   ├── shared/                 # 공통 유틸리티
│   │   ├── capabilities.ts     # Capability matrix
│   │   ├── normalized.ts       # 정형화 로직
│   │   ├── errors.ts           # 에러 정규화
│   │   ├── human-input.ts      # 휴먼 입력 처리
│   │   ├── cli.ts, sse.ts      # CLI/SSE 공통
│   │   ├── logger.ts           # 로깅
│   │   └── http.ts, json.ts, time.ts, process.ts
│   ├── auth/                   # 인증 모듈
│   │   ├── codex.ts (6KB)
│   │   ├── gemini.ts (3KB)
│   │   └── claude.ts
│   ├── types.ts                # 전체 타입 정의 (9KB)
│   └── config.ts               # 환경설정
├── test/                       # 테스트
├── docs/                       # 설계 문서
│   └── local-proxy-refactor-design.md (14KB)
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 3. 핵심 아키텍처 레이어

### 3.1 TUI Layer (thin client)

| 파일 | 역할 |
|---|---|
| [repl.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/repl.ts) | REPL 루프, 사용자 입력 → 명령 → 결과 출력 |
| [client.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts) | 프록시 HTTP 호출 (`/api/v1/chat`, `/api/v2/chat`, `/api/v2/batch` 등) |
| [parser.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/parser.ts) | 슬래시 명령어 파싱 (`/codex`, `/claude`, `/gemini`, `/all`, `/status`, `/self-test`) |
| [format.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/format.ts) | 결과 터미널 출력 포맷 |

> TUI는 Provider 세부 구현을 모르고, **프록시 API만 호출**합니다.

### 3.2 Proxy Layer (계약/정책/라우팅의 중심)

| 파일 | 역할 |
|---|---|
| [server.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/server.ts) | Express 서버 시작, 라우트 연결 |
| [router.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts) | Provider 선택 + Transport 우선순위 정책 (direct 우선 → CLI fallback) |
| [contracts.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts) | v2 API의 Rich 요청/응답 계약, Capability matrix |
| [routes-unified.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-unified.ts) | v1/v2 통합 API 라우트 |
| [routes-anthropic.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-anthropic.ts) | `POST /anthropic/v1/messages` 호환 엔드포인트 |
| [routes-openai.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-openai.ts) | `POST /openai/v1/chat/completions`, `/openai/v1/responses` 호환 엔드포인트 |
| `mapper-*.ts` | Anthropic/OpenAI 포맷 ↔ Normalized 포맷 양방향 매핑 |

### 3.3 Provider Layer

각 Provider는 **Adapter + Transport** 패턴으로 구성됩니다:

| Provider | 1차 Transport | 2차 Transport (Fallback) |
|---|---|---|
| **Codex** | Direct Backend (`chatgpt.com/backend-api`) | 없음 |
| **Claude** | Direct API (`api.anthropic.com/v1/messages`) | CLI (`claude -p`) |
| **Gemini** | Code Assist Direct (`streamGenerateContent`) | CLI (`gemini -p`) |

### 3.4 Shared Layer

에러 정규화, SSE 파싱, CLI 실행, Capability 매트릭스, 휴먼 입력 처리, 로깅 등 공통 로직.

---

## 4. API 엔드포인트 체계

### v1 (text-first 호환 레이어)
| Method | Path | 역할 |
|---|---|---|
| `GET` | `/api/v1/health` | 프록시 상태 확인 |
| `GET` | `/api/v1/providers` | Provider별 사용 가능 상태 |
| `POST` | `/api/v1/chat`, `/api/v1/batch` | 단일/다중 요청 |
| `POST` | `/api/v1/chat/stream`, `/api/v1/batch/stream` | 스트리밍 |
| `POST` | `/api/v1/self-test` | 스모크 테스트 |

### v2 (rich contract 기반)
| Method | Path | 역할 |
|---|---|---|
| `GET` | `/api/v2/capabilities` | Provider별 기능 매트릭스 |
| `GET` | `/api/v2/capabilities/:provider` | 개별 Provider 기능 조회 |
| `POST` | `/api/v2/chat`, `/api/v2/batch` | Rich 요청/응답 |
| `POST` | `/api/v2/chat/stream`, `/api/v2/batch/stream` | Rich 스트리밍 |

### 호환 API
| Method | Path | 역할 |
|---|---|---|
| `POST` | `/anthropic/v1/messages` | Anthropic 호환 |
| `POST` | `/openai/v1/chat/completions` | OpenAI Chat 호환 |
| `POST` | `/openai/v1/responses` | OpenAI Responses 호환 |

---

## 5. 타입 시스템 (핵심)

프로젝트의 타입 정의([types.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts))는 **356줄**로, 전체 계약 구조를 정의합니다:

| 인터페이스 | 역할 |
|---|---|
| [UnifiedRequest](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#119-139) | 통합 요청 (messages, tools, hostedTools, responseFormat, state, humanInputMode 등) |
| [UnifiedResponse](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#160-174) | 통합 응답 (parts, finishReason, usage, humanInput 등) |
| [UnifiedChunk](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#175-189) | 스트리밍 청크 |
| [NormalizedMessage](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#62-68) / [NormalizedContentPart](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#51-61) | 메시지 정형화 (text, image, file, tool_call, tool_result, reasoning, citation, refusal, json) |
| [ProviderAdapter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#329-336) / [ProviderTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#337-345) | Provider 구현 인터페이스 |
| [ProviderCapabilities](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#197-217) / [FeatureSupport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#190-196) | Capability matrix (platform / transport / effective 레벨) |
| [HumanInputRequest](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#42-50) | 사람 승인 요청 구조 |

---

## 6. 인증 소스

| Provider | 인증 방법 |
|---|---|
| Codex | `~/.codex/auth.json`, fallback `~/.chatgpt-codex-proxy/tokens.json` |
| Gemini | `~/.gemini/oauth_creds.json` |
| Claude (Direct) | `CLAUDE_CODE_OAUTH_TOKEN` 환경변수 |
| Claude (Fallback) | 로컬 `claude` CLI |
| Gemini (Fallback) | 로컬 `gemini` CLI |

---

## 7. 현재 구현 상태

### ✅ 구현 완료
- v1 text-first API + v2 rich contract API
- messages/parts/usage/finishReason 정형화
- Capability matrix (`/api/v2/capabilities`)
- Anthropic/OpenAI 호환 매핑 (rich request/response 양방향)
- Claude CLI / Gemini CLI 고급 기능 차단 + `unsupported_feature` 에러
- Claude API `web_search`, `code_execution` hosted tool 연동
- Claude API / Codex direct의 `tool_call`, `tool_result` history replay
- Anthropic/OpenAI compatibility streaming의 non-text part 전송
- Interactive hosted tool에 대한 `human_input_required` 반환 전략

### 🔸 Partial / Unverified
- file/PDF direct wiring
- citations/grounding direct extraction
- caching/state provider-specific wiring
- Codex structured output/tool/file 계열 backend-level 실증
- Claude 외 provider의 hosted/native tools 실제 wiring
- Human input 이후의 resume token / continuation

---

## 8. 설계 문서 핵심 내용

[local-proxy-refactor-design.md](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/docs/local-proxy-refactor-design.md) (563줄)는 프로젝트의 리팩터링 설계도로, 다음을 포함합니다:

1. **목표**: TUI 안에 섞여있던 provider 로직을 `thin client + local proxy + transport chain`으로 분리
2. **5단계 리팩터링 계획**: 계약 분리 → 프록시 도입 → Adapter/Transport 분리 → 헬스 정교화 → 스트리밍
3. **Transport 우선순위 정책**: direct 우선, CLI fallback
4. **에러 정규화**: `auth_missing`, `transport_unavailable`, `timeout` 등 공통 에러 코드
5. **휴먼 입력 전략**: `humanInputMode: "return" | "forbid"` 으로 interactive tool 제어

> 한 줄 결론: *"`multi-model-tui`는 `thin client + local proxy + provider transport chain` 구조로 분리하는 것이 가장 실무적이다."*
