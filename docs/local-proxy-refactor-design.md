# Multi Model TUI Local Proxy 리팩터링 설계도

## 구현 상태 메모

현재 코드 기준으로 아래는 구현 완료 상태다.

- `v1` text-first API 유지
- `v2` rich contract API 추가
- `messages[] / parts[] / usage / finishReason` 정형화
- `GET /api/v2/capabilities` provider support matrix 노출
- `Anthropic/OpenAI -> normalized request` rich 매핑
- `Claude CLI`, `Gemini CLI`의 고급 기능 요청 차단과 `unsupported_feature` 에러
- `Claude API`의 `web_search`, `code_execution` hosted tool wiring
- `Claude API`, `Codex direct`의 `tool_call`, `tool_result` history replay
- `Anthropic/OpenAI` compatibility streaming의 non-text part 전송
- interactive hosted tool에 대한 `human_input_required` 반환 전략

아직 `partial` 또는 `unverified`로 남아 있는 영역:

- file/PDF direct wiring
- citations/grounding direct extraction
- caching/state provider-specific wiring
- Codex structured output/tool/file 계열의 backend-level 실증
- Claude 외 provider의 hosted/native tools 실제 wiring
- human input 이후의 resume token / continuation

## 휴먼 입력 처리 전략

현재 프록시는 `computer_use`, `remote_mcp`처럼 사람이 승인해야 하는 interactive hosted tool을 자동 실행하지 않는다.

전략은 두 단계다.

1. `humanInputMode: "return"`

```text
client
  -> /api/v2/chat
  -> hostedTools includes computer_use
  -> proxy detects human approval requirement
  -> no transport execution
  -> returns:
     error.code = human_input_required
     humanInput = {
       kind: "approval",
       title,
       instructions,
       toolType,
       resumable: false
     }
```

2. `humanInputMode` 없음 또는 `"forbid"`

```text
client
  -> /api/v2/chat
  -> interactive hosted tool
  -> proxy fail-fast
  -> returns human_input_required without automatic resume path
```

의도는 세 가지다.

- 고급 tool을 조용히 버리지 않는다.
- 사람 개입이 필요한 요청을 명시적 상태로 끌어올린다.
- 현재 버전에서 지원하지 않는 `resume`를 지원하는 것처럼 거짓말하지 않는다.

## 1. 목표

현재 `multi-model-tui`는 TUI 프로세스 안에 provider별 인증, 요청 변환, 직접 호출, CLI fallback 로직이 함께 들어 있다.

목표 구조는 다음과 같다.

```text
TUI Client
  -> Local Proxy
     -> Provider Router
        -> Provider Adapter
           -> Direct Transport or CLI Transport
```

핵심 원칙:

- 프록시 앞단 계약은 하나로 통일한다.
- 프록시 뒷단 transport는 provider별로 달라도 된다.
- `Codex = direct backend`, `Claude = direct or CLI`, `Gemini = direct or CLI`를 인정한다.
- TUI는 provider 세부 구현을 모르고, 프록시 API만 호출한다.

## 2. 현재 구조 vs 목표 구조

### 현재 구조

```text
REPL
  -> parseCommand()
  -> provider.sendPrompt()
     -> auth
     -> direct HTTP or CLI fallback
  -> format result
```

문제:

- provider 로직이 TUI 안에 직접 박혀 있다.
- transport 교체가 어렵다.
- 스트리밍, 로깅, 정책, 캐시를 공통화하기 어렵다.
- `/all`의 fan-out과 provider 내부 fallback이 한 프로세스에 섞여 있다.

### 목표 구조

```text
REPL
  -> Local Proxy Client
     -> POST /v1/chat
     -> POST /v1/batch
  -> format result

Local Proxy
  -> request validate
  -> prompt normalize
  -> provider route
  -> transport execute
  -> result normalize
  -> JSON/SSE return
```

장점:

- TUI는 얇아진다.
- provider 로직과 실행 정책이 프록시에 집중된다.
- 나중에 GUI, MCP, HTTP API, 팀 공용 게이트웨이로 확장하기 쉽다.

## 3. 제안 아키텍처

```text
┌──────────────────────┐
│ multi-model-tui REPL │
│ - /codex             │
│ - /claude            │
│ - /gemini            │
│ - /all               │
└──────────┬───────────┘
           │ localhost HTTP
           v
┌──────────────────────────────────────┐
│ local-proxy                          │
│                                      │
│ 1. Request Contract Layer            │
│ 2. Router / Policy Layer             │
│ 3. Provider Adapter Layer            │
│ 4. Transport Layer                   │
│ 5. Response Normalization Layer      │
└───────┬────────────┬────────────┬────┘
        │            │            │
        v            v            v
   Codex Direct   Claude API   Gemini API
        │            │            │
        └──────┐     │     ┌──────┘
               v     v     v
              Claude CLI  Gemini CLI
```

## 4. 프록시 앞단 계약

프록시는 provider마다 다른 API를 노출하지 않는다.

### 4.1 최소 API 표면

| Method | Path | 역할 |
|---|---|---|
| `GET` | `/health` | 프록시 상태 확인 |
| `GET` | `/v1/providers` | provider별 현재 사용 가능 상태 |
| `POST` | `/v1/chat` | 단일 provider 요청 |
| `POST` | `/v1/batch` | 다중 provider 병렬 요청 |
| `POST` | `/v1/chat/stream` | 단일 provider 스트리밍 |
| `POST` | `/v1/batch/stream` | 다중 provider 스트리밍 |
| `POST` | `/v1/self-test` | provider별 스모크 테스트 |

### 4.2 UnifiedRequest

```ts
type ProviderName = "codex" | "claude" | "gemini";

interface UnifiedRequest {
  provider: ProviderName;
  prompt: string;
  model?: string;
  stream?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, string>;
}
```

### 4.3 UnifiedBatchRequest

```ts
interface UnifiedBatchRequest {
  providers: ProviderName[];
  prompt: string;
  stream?: boolean;
  timeoutMs?: number;
}
```

### 4.4 UnifiedResponse

```ts
interface UnifiedResponse {
  provider: ProviderName;
  ok: boolean;
  model: string;
  transport: string;
  elapsedMs: number;
  text: string;
  error?: string;
}
```

## 5. 프록시 뒷단 transport

중요한 것은 provider adapter 뒤에서 여러 transport가 체인처럼 붙는다는 점이다.

### 5.1 Codex

```text
CodexAdapter
  -> CodexDirectTransport
     -> ~/.codex/auth.json
     -> chatgpt.com/backend-api/codex/responses
     -> SSE parse
```

| 단계 | 처리 |
|---|---|
| 인증 | `~/.codex/auth.json` 또는 fallback |
| 요청 | direct backend POST |
| 응답 | SSE 누적 후 text 추출 |
| fallback | 없음 |

### 5.2 Claude

```text
ClaudeAdapter
  -> ClaudeApiTransport
     -> CLAUDE_CODE_OAUTH_TOKEN
     -> api.anthropic.com/v1/messages
  -> failover
  -> ClaudeCliTransport
     -> claude -p --output-format json
```

| 단계 | 처리 |
|---|---|
| 1차 | direct API 호출 |
| 2차 | direct 실패 또는 token 없음 시 CLI fallback |
| 결과 | text block 또는 CLI `result` |

### 5.3 Gemini

```text
GeminiAdapter
  -> GeminiCodeAssistTransport
     -> ~/.gemini/oauth_creds.json
     -> loadCodeAssist / serviceusage / streamGenerateContent
  -> failover
  -> GeminiCliTransport
     -> gemini -p -o json
```

| 단계 | 처리 |
|---|---|
| 1차 | Code Assist direct 경로 |
| 2차 | project/API 상태 문제 시 CLI fallback |
| 결과 | SSE text 또는 CLI `response` |

## 6. Router / Policy Layer

프록시는 단순 분기기가 아니라 transport 정책도 가진다.

### 6.1 provider 라우팅

```text
/v1/chat
  provider=codex   -> CodexAdapter
  provider=claude  -> ClaudeAdapter
  provider=gemini  -> GeminiAdapter
```

### 6.2 transport 우선순위

| Provider | 1순위 | 2순위 |
|---|---|---|
| Codex | `direct` | 없음 |
| Claude | `direct-api` | `cli` |
| Gemini | `direct-code-assist` | `cli` |

### 6.3 선택 정책

```ts
interface TransportPolicy {
  preferred: string[];
  allowFallback: boolean;
  requireHealthy?: boolean;
}
```

예시:

```text
Claude:
  preferred = [direct-api, cli]
  allowFallback = true

Gemini:
  preferred = [direct-code-assist, cli]
  allowFallback = true
```

## 7. `/all` 병렬 fan-out 구조

현재 `/all`은 TUI에서 provider를 병렬 호출한다.

리팩터링 후에는 프록시가 병렬 fan-out을 담당한다.

```text
TUI
  -> POST /v1/batch { providers: [codex, claude, gemini], prompt }
  -> Local Proxy
     -> Promise.allSettled([
          CodexAdapter.execute(),
          ClaudeAdapter.execute(),
          GeminiAdapter.execute()
        ])
     -> UnifiedResponse[]
  -> TUI renders in fixed order
```

장점:

- TUI는 fan-out 로직을 몰라도 된다.
- 타임아웃, 재시도, 실패 격리를 프록시에서 통합할 수 있다.

## 8. 스트리밍 설계

1차 리팩터링에서는 non-streaming 우선이 맞다.

2차에서 SSE를 도입한다.

### 8.1 스트리밍 이벤트 계약

```ts
type UnifiedChunkType =
  | "start"
  | "delta"
  | "end"
  | "error"
  | "meta";

interface UnifiedChunk {
  provider: ProviderName;
  type: UnifiedChunkType;
  text?: string;
  error?: string;
  model?: string;
}
```

### 8.2 provider별 스트리밍 차이

| Provider | 실제 소스 | 프록시 처리 |
|---|---|---|
| Codex | backend SSE | 거의 그대로 흡수 |
| Claude | direct는 JSON, CLI는 완성형 | initially pseudo-stream 또는 final-only |
| Gemini | Code Assist SSE, CLI는 완성형 | initially pseudo-stream 또는 final-only |

즉, 통합 스트리밍은 가능하지만 Claude/Gemini CLI fallback은 진짜 stream이 아니라 `final-only chunk`가 될 가능성이 높다.

## 9. 상태/헬스 체크 설계

프록시는 단순한 `auth file exists` 체크보다 더 현실적인 건강 상태를 반환해야 한다.

### 9.1 ProviderStatus

```ts
interface ProviderStatus {
  provider: ProviderName;
  healthy: boolean;
  primaryTransport: string;
  fallbackTransport?: string;
  reason?: string;
}
```

### 9.2 예시 출력

```json
[
  {
    "provider": "codex",
    "healthy": true,
    "primaryTransport": "direct"
  },
  {
    "provider": "claude",
    "healthy": true,
    "primaryTransport": "cli",
    "reason": "direct token missing"
  },
  {
    "provider": "gemini",
    "healthy": true,
    "primaryTransport": "cli",
    "reason": "Code Assist project unavailable"
  }
]
```

## 10. 에러 정규화

프록시 앞단은 provider 고유 에러를 그대로 노출하지 않는다.

### 10.1 공통 에러 코드

| 코드 | 의미 |
|---|---|
| `auth_missing` | 인증 소스 없음 |
| `auth_invalid` | 인증 만료 또는 거절 |
| `transport_unavailable` | CLI/API/backend 사용 불가 |
| `timeout` | 타임아웃 |
| `rate_limited` | 레이트 리밋 |
| `invalid_response` | 응답 파싱 실패 |
| `provider_error` | provider 자체 에러 |

### 10.2 에러 응답

```ts
interface UnifiedError {
  provider: ProviderName;
  code: string;
  message: string;
  transport?: string;
  raw?: string;
}
```

## 11. 관측/로깅

프록시가 들어오면 다음 로그를 공통으로 남길 수 있다.

| 로그 항목 | 설명 |
|---|---|
| request id | 요청 추적 |
| provider | 대상 provider |
| selected transport | 선택된 transport |
| fallback used | fallback 사용 여부 |
| elapsed ms | 응답 시간 |
| ok/fail | 결과 |
| error code | 정규화 에러 코드 |

예시:

```text
[proxy] req=abc provider=gemini transport=cli fallback=true elapsed=18465 ok=true
```

## 12. 목표 디렉터리 구조

```text
multi-model-tui/
  src/
    tui/
      repl.ts
      client.ts
      format.ts
      parser.ts
    proxy/
      server.ts
      routes.ts
      contracts.ts
      router.ts
      policy.ts
      status.ts
    providers/
      codex/
        adapter.ts
        direct-transport.ts
        auth.ts
      claude/
        adapter.ts
        api-transport.ts
        cli-transport.ts
      gemini/
        adapter.ts
        code-assist-transport.ts
        cli-transport.ts
        auth.ts
    shared/
      errors.ts
      sse.ts
      cli.ts
      time.ts
```

## 13. 단계별 리팩터링 순서

### Phase 1. 계약 분리

- `ProviderResult`, `AuthStatus`, 공통 에러 타입을 `proxy/contracts.ts`로 이동
- provider 내부에서 transport 선택을 명시적 객체로 분리

### Phase 2. Local Proxy 도입

- `server.ts` 추가
- `/health`, `/v1/providers`, `/v1/chat`, `/v1/batch` 구현
- TUI는 provider 직접 호출 대신 localhost HTTP 호출로 변경

### Phase 3. Adapter / Transport 분리

- `CodexProvider` -> `CodexAdapter + CodexDirectTransport`
- `ClaudeProvider` -> `ClaudeAdapter + ClaudeApiTransport + ClaudeCliTransport`
- `GeminiProvider` -> `GeminiAdapter + GeminiCodeAssistTransport + GeminiCliTransport`

### Phase 4. 상태/헬스 정교화

- startup auth check를 `ProviderStatus` API로 통일
- direct 가능/CLI만 가능 상태를 구분

### Phase 5. Streaming

- `/v1/chat/stream`, `/v1/batch/stream` 추가
- direct SSE는 real stream
- CLI fallback은 final chunk 방식으로 통합

## 14. 추천 우선 구현 범위

가장 실무적인 최소 리팩터링은 아래다.

1. `Local Proxy`를 `localhost:4317` 같은 고정 포트로 띄운다.
2. TUI는 HTTP client만 남긴다.
3. `/v1/chat`, `/v1/batch`, `/v1/providers`, `/health`만 먼저 구현한다.
4. 스트리밍은 2차로 미룬다.
5. direct/API/CLI 선택은 프록시 안에서만 처리한다.

## 15. 최종 권장안

```text
TUI = 화면/입력 전용
Proxy = 계약/정책/라우팅/관측의 중심
Transport = provider별 실제 접속 방식
```

이 구조가 되면:

- 지금의 `빠른 응답` 장점은 유지할 수 있다.
- provider별 접속 방식 차이를 숨길 수 있다.
- `/all`과 추후 `streaming`, `caching`, `history`, `self-test`를 안정적으로 확장할 수 있다.

---

한 줄 결론:

> `multi-model-tui`는 다음 단계에서 `thin client + local proxy + provider transport chain` 구조로 분리하는 것이 가장 실무적이다.
