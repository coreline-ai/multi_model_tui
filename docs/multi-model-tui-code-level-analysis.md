# Multi-Model-TUI 코드 레벨 분석 보고서

> 전체 소스 파일 약 **58개**, TypeScript 약 **4,000행+** 분석 결과

---

## 1. 엔트리포인트 (`src/bin/`)

### [dev.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/bin/dev.ts) — 54행
**통합 실행** 엔트리포인트. Proxy → TUI를 순차 기동합니다.

```text
main()
  → loadConfig()
  → spawnNodeModule(proxy.ts)          // 자식 프로세스로 프록시 기동
  → waitForHealth(healthUrl, timeout)   // 250ms 폴링으로 헬스 대기
  → spawnNodeModule(tui.ts)            // TUI 프로세스 기동
  → tui exit → proxy SIGTERM
```

- `spawnNodeModule()`은 [.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/repl.ts)/`.js` 확장자를 자동 감지하여 `tsx` 또는 `node` 실행
- `SIGINT/SIGTERM` 시그널로 graceful shutdown

### [proxy.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/bin/proxy.ts) — 29행
프록시 단독 실행. [createProxyServer(config).listen()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/server.ts#16-73) 호출 후 시그널 대기.

### [tui.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/bin/tui.ts) — 16행
TUI 단독 실행. [startRepl(config)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/repl.ts#39-99) 한 줄.

---

## 2. 설정 ([src/config.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/config.ts)) — 42행

[config.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/config.ts)

| 설정 | 환경변수 | 기본값 |
|---|---|---|
| `codexModel` | `TUI_CODEX_MODEL` | `gpt-5` |
| `geminiModel` | `TUI_GEMINI_MODEL` | `gemini-2.5-pro` |
| `claudeModel` | `TUI_CLAUDE_MODEL` | `claude-sonnet-4-5` |
| `codexBaseUrl` | `CODEX_BASE_URL` | `https://chatgpt.com/backend-api` |
| `claudeBaseUrl` | `CLAUDE_BASE_URL` | `https://api.anthropic.com` |
| `codexAuthPath` | `CODEX_AUTH_PATH` | `~/.codex/auth.json` |
| `geminiAuthPath` | `GEMINI_AUTH_PATH` | `~/.gemini/oauth_creds.json` |
| `proxyPort` | `TUI_PROXY_PORT` | `4317` |
| `requestTimeoutMs` | — | `60,000` (60초) |

헬퍼: [expandHomePath()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/config.ts#5-11) (~ 지원), [parsePort()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/config.ts#12-17), [parseLogLevel()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/config.ts#18-22)

---

## 3. TUI 레이어 (`src/tui/`) — 4파일, 331행

### [repl.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/repl.ts) — 99행
```text
startRepl(config)
  → createLocalProxyClient(config)
  → client.getProviders() → formatStartup()
  → while(true) readline loop:
      → parseCommand(line)
      → kind=exit     → break
      → kind=help     → formatHelp()
      → kind=status   → getProviders() + getCapabilities() → formatStatus()
      → kind=self-test → selfTest() → formatSelfTest()
      → kind=provider, /all → client.batchV2() → formatAllResults()
      → kind=provider, 개별  → client.chatV2() → formatSingleResult()
```

- **v2 API** 사용 ([chatV2](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#351-352), [batchV2](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts#64-72)) — `messages[]` 배열 기반
- [toProviderResult()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/repl.ts#16-38) 헬퍼로 v2 응답 → [ProviderResult](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#289-298)로 변환

### [client.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts) — 82행
[LocalProxyClient](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#346-356) 인터페이스 구현. 7개 HTTP fetch 래퍼:

| 메서드 | 경로 | API 버전 |
|---|---|---|
| [getHealth()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#347-348) | `GET /api/v1/health` | v1 |
| [getProviders()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#348-349) | `GET /api/v1/providers` | v1 |
| [getCapabilities()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#45-51) | `GET /api/v2/capabilities` | v2 |
| [chat()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts#40-48) | `POST /api/v1/chat` | v1 |
| [chatV2()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#351-352) | `POST /api/v2/chat` | v2 |
| [batch()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#61-90) | `POST /api/v1/batch` | v1 |
| [batchV2()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts#64-72) | `POST /api/v2/batch` | v2 |
| [selfTest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts#72-80) | `POST /api/v1/self-test` | v1 |

`readJson<T>()` 헬퍼: HTTP 에러 시 body 텍스트를 에러 메시지로 전달

### [parser.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/parser.ts) — 41행
[parseCommand(input)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/parser.ts#5-41) → [ParsedCommand](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#281-288) 반환

- 빈 입력 / `/` 미접두사 → `invalid`
- `/help`, `/exit`, `/status`, `/self-test` → 각각의 kind
- `/codex`, `/claude`, `/gemini`, `/all` + prompt → `kind: "provider"`
- prompt 없는 provider 명령 → `invalid`

### [format.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts) — 109행
5개 포맷 함수:
- [formatStartup()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts#17-25) — provider availability 표시
- [formatStatus()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts#26-46) — 상세 상태 + capability summary
- [formatSingleResult()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts#47-55) — `[provider] model= transport= elapsed=` 형식
- [formatAllResults()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts#56-92) — provider 순서(`codex→claude→gemini`)로 YAML-like 출력
- [formatSelfTest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/format.ts#93-109) — 스모크 테스트 결과 (expected vs actual)

---

## 4. Proxy 레이어 (`src/proxy/`) — 11파일, ~1,700행

### [server.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/server.ts) — 73행
```text
createProxyServer(config, adapters?)
  → express() + json(2MB)
  → 로깅 미들웨어 (method + path)
  → registerHealthRoutes(app, config)
  → registerUnifiedRoutes(app, proxyRouter)
  → registerAnthropicRoutes(app, proxyRouter)
  → registerOpenAiRoutes(app, proxyRouter)
  → 404 핸들러
  → listen() : Promise<{ close() }>
```

- `adapters` 파라미터로 테스트 시 mock 주입 가능

### [router.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts) — 201행

**핵심 로직 집중 모듈.** [ProxyRouter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#21-29) 인터페이스:

| 메서드 | 동작 |
|---|---|
| [getStatuses()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#50-54) | 3개 provider 병렬 [getStatus()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#14-44) |
| [getCapabilities(provider?)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#45-51) | 전체/개별 capability report |
| [execute(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#58-61) | [executeAdapter()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#121-160) → human-input 검사 → adapter.execute() |
| [batch(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#61-90) | `Promise.all(providers.map(executeAdapter))` → PROVIDER_ORDER 정렬 |
| [stream(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/adapter.ts#64-83) | [streamAdapter()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#161-201) → human-input 검사 → adapter.stream() |
| [selfTest(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/tui/client.ts#72-80) | 고정 프롬프트 "reply with exactly: X ok" → 결과 비교 |

**[executeAdapter()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#121-160)** — 핵심 실행 함수:
```text
1. getHumanInputRequirement(req) → interactive tool 감지
2. humanInputMode="return" → human_input_required 에러 반환
3. humanInputMode 없음/forbid → throw 에러
4. 정상 → adapter.execute(req)
5. catch → toUnifiedError() 변환
```

### [contracts.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts) — 432행

**가장 큰 프록시 파일.** 요청/응답 파싱 + 변환 로직:

| 함수 | 역할 |
|---|---|
| [parseContentPart()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#35-124) | 10종 content part(text, image, file, tool_call, tool_result, reasoning, citation, refusal, json) 개별 파싱 |
| [parseMessages()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#130-151) | role 검증 + parts 파싱 + content string fallback |
| [parseTools()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#152-168) / [parseHostedTools()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#169-183) | tool/hosted-tool 배열 검증 |
| [parseResponseFormat()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#184-194) | text/json_object/json_schema 파싱 |
| [parseState()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#195-209) | previousResponseId, conversationId, thoughtSignatures, cacheKey |
| [parseCapabilityPolicy()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#210-240) | require 배열 + allowBestEffort/allowProviderExtensions |
| [parseUnifiedRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#248-281) | v1용 (prompt 필수) |
| [parseRichUnifiedRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#282-320) | v2용 (prompt 또는 messages 필수) |
| [parseUnifiedBatchRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#321-344) | v1 batch |
| [parseRichUnifiedBatchRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#345-382) | v2 batch |
| [toChatResponse()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#394-405) / [toBatchResponse()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/contracts.ts#406-411) | v1 응답 변환 |

### [routes-unified.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-unified.ts) — 202행

10개 엔드포인트 등록:
- `GET /api/v1/providers`, `GET /api/v2/capabilities(/:provider)`
- `POST /api/v1/chat`, `/api/v2/chat` (non-stream)
- `POST /api/v1/batch`, `/api/v2/batch` (non-stream)
- `POST /api/v1/self-test`
- `POST /api/v1/chat/stream`, `/api/v2/chat/stream` — SSE 헤더 + [writeStream()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-unified.ts#27-36) loop
- `POST /api/v1/batch/stream`, `/api/v2/batch/stream` — 다중 provider 병렬 SSE

### [routes-anthropic.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-anthropic.ts) — 201행

`POST /anthropic/v1/messages` — Anthropic Messages API 호환:
- **Stream 시**: `message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop` 이벤트 시퀀스
- **Non-stream 시**: [unifiedToAnthropic()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-anthropic.ts#187-233) 변환
- text block 자동 open/close 관리 ([ensureTextBlock](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-anthropic.ts#105-118) / [closeTextBlock](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-anthropic.ts#119-124))
- `tool_call` part → `tool_use` content block 변환
- `human_input_required` → HTTP 409

### [routes-openai.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/routes-openai.ts) — 263행

2개 엔드포인트:
- `POST /openai/v1/chat/completions` — Chat Completions API 호환
  - Stream: `chat.completion.chunk` 이벤트 + `data: [DONE]`
  - tool_call → `delta.tool_calls[]` 변환
- `POST /openai/v1/responses` — Responses API 호환
  - Stream: `response.created → response.output_text.delta → response.output_item.added/done → response.completed`

### [mapper-anthropic.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-anthropic.ts) — 233행

| 함수 | 방향 | 핵심 처리 |
|---|---|---|
| [anthropicToUnified()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-anthropic.ts#107-186) | Anthropic → Normalized | model 기반 provider 추론, system 정규화, tool/hosted-tool 분리(web_search/code_execution/computer_use) |
| [unifiedToAnthropic()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-anthropic.ts#187-233) | Normalized → Anthropic | parts → content blocks, finishReason → stop_reason 매핑 |
| [parseAnthropicContent()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-anthropic.ts#39-92) | — | text/image(base64+url)/tool_use/tool_result 파싱 |

### [mapper-openai.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-openai.ts) — 298행

| 함수 | 방향 | 핵심 처리 |
|---|---|---|
| [openAiToUnified()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-openai.ts#108-215) | OpenAI → Normalized | Chat/Responses 양쪽 포맷 파싱, tool_calls/function 변환, response_format 매핑 |
| [unifiedToChatCompletion()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-openai.ts#216-256) | Normalized → Chat Completion | choices[0].message 구성, tool_calls 매핑 |
| [unifiedToOpenAiResponse()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/mapper-openai.ts#257-298) | Normalized → Responses API | output[] 배열 구성, function_call 매핑 |

---

## 5. Provider 레이어 (`src/providers/`) — 7파일 + 3 하위 디렉터리

### [base.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/base.ts) — 63행
[BaseProvider](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/base.ts#31-63) 추상 클래스 (레거시 [ProviderClient](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#304-310) 인터페이스용):
- [sendPrompt()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/base.ts#37-60) 템플릿 메서드: 타이밍 측정 + 에러 정규화
- [HttpStatusError](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/base.ts#4-14) 클래스: HTTP status code별 에러 메시지 생성

### Adapter 패턴 (각 Provider 공통)

**[ProviderAdapter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#329-336) 인터페이스**: [getStatus()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#14-44), [getCapabilities()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#45-51), [execute()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#58-61), [stream()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/adapter.ts#64-83)

| Adapter | Transport Chain | Fallback 전략 |
|---|---|---|
| [CodexAdapter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/adapter.ts#5-36) (36행) | [CodexDirectTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#169-425) | 없음 (단일) |
| [ClaudeAdapter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/adapter.ts#6-84) (84행) | `ClaudeApiTransport → ClaudeCliTransport` | 순차 시도, yielded 후 에러 시 fallback 스킵 |
| [GeminiAdapter](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/adapter.ts#6-84) (84행) | `GeminiCodeAssistTransport → GeminiCliTransport` | 동일 패턴 |

**Claude/Gemini Adapter 스트리밍 Fallback 로직**:
```typescript
async *stream(req) {
  for (const transport of this.transports) {
    let yielded = false;
    try {
      for await (const chunk of transport.stream(req)) {
        yielded = true;
        yield chunk;  // 한 번이라도 yield하면...
      }
      return;
    } catch (error) {
      if (yielded) throw error;  // 이미 클라이언트에 전달, fallback 불가
    }
  }
  throw lastError;
}
```

### Transport 구현

#### [CodexDirectTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts) — 425행

**가장 복잡한 Transport.** Codex backend API 직접 호출:

| 메서드 | 역할 |
|---|---|
| [checkAvailability()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#223-233) | `getValidCodexTokens()` 검증 |
| [execute(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/proxy/router.ts#58-61) | [runRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#378-424) → [extractFinalText()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#26-35) + [extractParts()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#36-63) |
| [stream(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/adapter.ts#64-83) | SSE 파싱 → delta/tool_call/reasoning/json chunk yield |
| [buildRequestBody()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/transport-code-assist.ts#239-262) | messages → input items, tools, response_format 구성 |
| [buildInput()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#125-129) | `NormalizedMessage[]` → Codex의 item 배열 변환 |
| [buildMessageItems()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#92-124) | tool_call/tool_result/reasoning part → Codex 포맷 매핑 |
| [buildTools()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#130-140) | `NormalizedToolDefinition[]` → `{type:"function"}` 배열 |
| [buildResponseFormat()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/codex/transport-direct.ts#141-168) | json_schema → `json_schema` / json_object → `{type:"json_object"}` |

**스트리밍 이벤트 처리**:
```text
SSE event types:
  "response.created"      → start chunk
  "response.output_text.delta" → delta chunk (text)
  "response.output_item.added" → tool_call/reasoning part
  "response.completed"    → end chunk with usage/finishReason
```

#### [ClaudeApiTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/transport-api.ts) — 534행

Anthropic Messages API 직접 호출. 핵심 기능:

- **Hosted Tools**: `web_search → web_search_20250305`, `code_execution → code_execution_20250825` + beta header 주입
- **Structured Output Shim**: Claude는 native JSON mode 없음 → `emit_json` 도구 + `tool_choice: {"type":"tool","name":"emit_json"}` 패턴으로 강제
- **Content Part 매핑**: image(base64/url), tool_call→tool_use, tool_result 양방향
- **스트리밍**: `content_block_start → content_block_delta → content_block_stop → message_delta(usage) → message_stop` 파싱

#### [GeminiCodeAssistTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/transport-code-assist.ts) — 479행

GCP Cloud Code Assist API 호출. 가장 복잡한 초기화 로직:

```text
checkAvailability()
  → getGeminiOAuthClient(authPath) → OAuth2Client
  → discoverProjectId(client):
      1. config에 projectId 있으면 사용
      2. loadCodeAssist(token, projectId) 시도
      3. 실패 → listAccessibleProjectIds(token) → 첫 번째 시도
      4. 실패 → onboardProject(token):
           listAccessibleProjectIds → getServiceState(ENABLED?) → 
           buildGeminiActivationUrl → fetch(activationUrl) → retry
  → 캐시에 projectId 저장
```

- **API 엔드포인트**: `cloudcode-pa.googleapis.com/v1internal/projects/{id}/locations/global/agents/chat-bison
/completions:streamGenerateContent`
- 응답 SSE 파싱 → text parts → NormalizedContentPart 변환

#### [ClaudeCliTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/transport-cli.ts) — 86행

```text
execute(req)
  → assertTransportSupportsRequest(req, capabilities)  // 고급 기능 요청 차단
  → collapseMessagesToPrompt(messages, system)           // messages → 단일 텍스트
  → runCliCommand("claude", ["-p", prompt, "--output-format", "json", ...])
  → extractJsonPayload<ClaudeCliResponse>(stdout)
  → { result: "..." }

stream(req)
  → execute() → pseudo-stream (start → delta → end)
```

- `--permission-mode plan --tools ""` → 로컬 tool 비활성화
- `pseudoTty = true` (macOS) → `script -q /dev/null` 래핑

#### [GeminiCliTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/gemini/transport-cli.ts) — 85행

동일 패턴: `gemini -p prompt -o json` → `{ response: "..." }` 파싱

---

## 6. 공통 모듈 (`src/shared/`) — 11파일, ~600행

### [errors.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/errors.ts) — 111행

| 클래스/함수 | 역할 |
|---|---|
| [HttpStatusError](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/base.ts#4-14) | HTTP 상태 코드 + body 래핑 |
| [UnifiedProxyError](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/errors.ts#14-24) | [UnifiedError](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#25-41) + statusCode + humanInput 래핑 |
| [unsupportedFeatureError()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/errors.ts#25-36) | capability 미지원 에러 팩토리 |
| [humanInputRequiredError()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/errors.ts#37-53) | human-input 에러 팩토리 (HTTP 409) |
| [toUnifiedError()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/errors.ts#54-111) | 모든 에러 → [UnifiedError](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#25-41) 정규화 (status별 코드 매핑) |

에러 코드 매핑:
```text
401 → auth_invalid  |  429 → rate_limited  |  403 → provider_error
AbortError → timeout  |  "not found" → transport_unavailable
"invalid provider response" → invalid_response
"not supported" → unsupported_feature
기타 → provider_error
```

### [normalized.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts) — 161행

메시지/파트 정형화 유틸:

| 함수 | 역할 |
|---|---|
| [ensureMessages(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#16-27) | prompt string → `[{role:"user", parts:[textPart]}]` 변환 |
| [extractTextFromParts(parts)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#28-45) | parts 배열 → 텍스트 합산 (text/json/tool_result/refusal/reasoning) |
| [collapseMessagesToPrompt()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#46-61) | messages → "SYSTEM:\n...\nUSER:\n..." 단일 문자열 (CLI용) |
| [collectSystemInstruction()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#62-75) | system/developer role 메시지 추출 |
| [filterChatMessages()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#76-79) | system/developer 제외 |
| [inferRequestedFeatures(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#84-125) | 요청에서 사용된 capability feature 목록 추론 |
| [effectiveSupport(platform, transport)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/normalized.ts#130-139) | 두 레벨의 minimum 계산 |

### [capabilities.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/capabilities.ts) — 58행

- [mergeCapabilities()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/capabilities.ts#5-30) — status + transports → [ProviderCapabilityReport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#218-224)
- [assertTransportSupportsRequest()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/capabilities.ts#51-58) — 요청된 feature가 transport에서 `none`이면 throw

### [human-input.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/human-input.ts) — 36행

- `INTERACTIVE_HOSTED_TOOLS` = `{computer_use, remote_mcp}`
- [getHumanInputRequirement(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/human-input.ts#17-32) — hostedTools에 interactive tool 포함 시 [HumanInputRequest](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/types.ts#42-50) 반환
- [shouldReturnHumanInput(req)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/human-input.ts#33-36) — `humanInputMode === "return"` 여부

### [cli.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/cli.ts) — 78행

- [commandExists(cmd)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/cli.ts#10-21) — `sh -lc "command -v cmd"` (login shell로 PATH 보장)
- [runCliCommand()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/cli.ts#22-51) — macOS pseudo-TTY 대응 (`script -q /dev/null`), maxBuffer 10MB
- [stripAnsi()](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/cli.ts#52-55) — ANSI escape 제거
- `extractJsonPayload<T>()` — JSON 파싱 실패 시 첫 `{` ~ 마지막 `}` 범위 재시도

### [sse.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/sse.ts) — 58행
- [parseSseEvents(stream)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/sse.ts#6-35) — `ReadableStream` → `AsyncGenerator<SseEvent>` (event/data 분리)
- [formatSseEvent(event, data)](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/sse.ts#55-58) — `"event: name\ndata: json\n\n"` 포맷

### [logger.ts](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/shared/logger.ts) — 37행
레벨 기반 로거 (debug=10, info=20, error=30). `[proxy]` 접두사 + key=value 포맷.

---

## 7. 데이터 흐름 다이어그램

### 7.1 단일 요청 (`/codex hello`)
```text
TUI(repl.ts)
  → parseCommand("/codex hello") → {kind:"provider", provider:"codex", prompt:"hello"}
  → client.chatV2({provider:"codex", messages:[{role:"user",parts:[{type:"text",text:"hello"}]}]})
    → fetch POST /api/v2/chat

Proxy(routes-unified.ts)
  → parseRichUnifiedRequest(body) → UnifiedRequest
  → proxyRouter.execute(req)

Router(router.ts)
  → getHumanInputRequirement(req) → undefined (interactive tool 없음)
  → adapters["codex"].execute(req)

CodexAdapter(adapter.ts)
  → transport.execute(req)

CodexDirectTransport(transport-direct.ts)
  → getValidCodexTokens(config) → accessToken
  → buildRequestBody(req, model) → {model, input, tools?, response_format?}
  → fetch(codexBaseUrl + "/codex/responses", {body, SSE headers})
  → parseSseEvents(response.body)
  → 누적 → extractFinalText() + extractParts()
  → UnifiedResponse {ok:true, text, parts, model, transport:"direct", elapsedMs}

← JSON 응답 → TUI formatSingleResult() → 터미널 출력
```

### 7.2 Anthropic 호환 요청 (`POST /anthropic/v1/messages`)
```text
External Client
  → POST /anthropic/v1/messages {model:"claude-...", messages:[], stream:true}

Proxy(routes-anthropic.ts)
  → anthropicToUnified(body) → UnifiedRequest {provider:"claude", messages, stream:true}
  → proxyRouter.stream(unified)

ClaudeAdapter
  → ClaudeApiTransport.stream(req)  [1차 시도]
    → CLAUDE_CODE_OAUTH_TOKEN 확인
    → fetch(api.anthropic.com/v1/messages, SSE)
    → SSE 이벤트 → UnifiedChunk yield

  → 실패 시 → ClaudeCliTransport.stream(req) [fallback]
    → claude -p prompt --output-format json
    → pseudo-stream: start → delta(full text) → end

← SSE 변환: message_start → content_block_start → content_block_delta → ... → message_stop
```

---

## 8. 핵심 디자인 패턴

### 8.1 Adapter + Transport Chain
```text
ProviderAdapter (인터페이스)
  ├─ getStatus()      → ProviderStatus
  ├─ getCapabilities() → ProviderCapabilityReport
  ├─ execute(req)     → UnifiedResponse
  └─ stream(req)      → AsyncGenerator<UnifiedChunk>

ProviderTransport (인터페이스)
  ├─ checkAvailability() → {ok, reason?}
  ├─ getCapabilities()   → ProviderCapabilities
  ├─ execute(req)        → UnifiedResponse
  └─ stream(req)         → AsyncGenerator<UnifiedChunk>
```

Adapter는 Transport 배열을 순회하며 첫 성공을 반환 (Chain of Responsibility).

### 8.2 Capability-Based Guard
```text
요청 → inferRequestedFeatures(req) → Set<CapabilityFeature>
       → assertTransportSupportsRequest(req, capabilities)
       → transport.features[feature].transport === "none" → throw unsupported_feature
```

CLI transport는 고급 기능(toolCalling, hostedTools, imageInput 등)이 모두 `"none"` → 자동 차단.

### 8.3 Human-Input Interception
```text
Router.executeAdapter()
  → getHumanInputRequirement(req)
  → computer_use 또는 remote_mcp 감지
  → humanInputMode="return" → error response with humanInput payload
  → humanInputMode=undefined/"forbid" → throw error (fail-fast)
```

### 8.4 Structured Output Shim (Claude)
```text
responseFormat.type = "json_schema"
  → Claude API에는 native JSON mode 없음
  → appendStructuredOutputShim():
      tools.push({name:"emit_json", input_schema: schema})
      tool_choice = {type:"any"}
  → 응답의 tool_use(emit_json) → json part로 변환
```

---

## 9. 코드 통계 요약

| 레이어 | 파일 수 | 총 코드 행 | 핵심 복잡도 |
|---|---|---|---|
| Entry (`bin/`) | 3 | ~99 | 낮음 |
| Config | 1 | 42 | 낮음 |
| TUI | 4 | ~331 | 낮음 (thin client) |
| Proxy Core | 11 | ~1,700 | **높음** (contracts 432행, mappers 531행) |
| Provider Adapters | 3 | ~204 | 중간 |
| Provider Transports | 5 | ~1,610 | **높음** (SSE, OAuth, 포맷 변환) |
| Shared | 11 | ~600 | 중간 |
| Types | 1 | 356 | — |
| **합계** | **~39 src 파일** | **~4,940행** | — |

---

## 10. 주목할 만한 구현 세부사항

### 1️⃣ macOS pseudo-TTY 대응
[ClaudeCliTransport](file:///Users/hwanchoi/projects_202603/calude_proxy_agent/multi-model-tui/src/providers/claude/transport-cli.ts#8-86)에서 `script -q /dev/null` 래핑으로 darwin 환경의 TTY 요구사항 해결.

### 2️⃣ Codex 토큰 이중 경로
`~/.codex/auth.json` (주) → `~/.chatgpt-codex-proxy/tokens.json` (fallback) 순서.

### 3️⃣ Gemini 프로젝트 자동 온보딩
OAuth 인증 → 프로젝트 목록 조회 → Service 활성화 검사 → Code Assist 활성화 URL 호출 → 자동 온보딩.

### 4️⃣ SSE 파서의 robust 구현
`\r\n\r\n` 또는 `\n\n` 양쪽 boundary 처리 + 마지막 불완전 이벤트까지 파싱.

### 5️⃣ JSON 추출 fallback
CLI 출력에 ANSI 코드나 추가 텍스트가 섞여도 첫 `{` ~ 마지막 `}` 범위 재파싱으로 대응.
