# Provider별 상세 테스트 케이스 문서

> 작성일: 2026-03-07  
> 대상: multi-model-tui v0.6.0  
> 총 테스트 케이스: **196건**

---

## 목차

1. [기존 테스트 현황](#1-기존-테스트-현황)
2. [Codex Provider 테스트](#2-codex-provider-테스트)
3. [Claude Provider 테스트](#3-claude-provider-테스트)
4. [Gemini Provider 테스트](#4-gemini-provider-테스트)
5. [Cross-Provider 공통 테스트](#5-cross-provider-공통-테스트)
6. [Proxy 라우트 통합 테스트](#6-proxy-라우트-통합-테스트)
7. [호환성 API 테스트](#7-호환성-api-테스트)
8. [공통 모듈 단위 테스트](#8-공통-모듈-단위-테스트)

---

## 1. 기존 테스트 현황

| 파일 | 행수 | 커버 영역 | 상태 |
|---|---|---|---|
| `test/parser.test.ts` | 69 | TUI 커맨드 파싱 | ✅ 구현됨 |
| `test/format.test.ts` | 57 | 출력 포매팅 | ✅ 구현됨 |
| `test/codex-auth.test.ts` | 51 | Codex 인증 파싱 | ✅ 구현됨 |
| `test/gemini-auth.test.ts` | 43 | Gemini 인증 파싱 | ✅ 구현됨 |
| `test/all-command.test.ts` | 28 | /all 명령 포매팅 | ✅ 구현됨 |
| `test/cli-utils.test.ts` | 17 | CLI 유틸리티 | ✅ 구현됨 |
| `test/unit/compat-mappers.test.ts` | 133 | Anthropic/OpenAI 매퍼 | ✅ 구현됨 |
| `test/unit/contracts-v2.test.ts` | 63 | v2 계약 파서 | ✅ 구현됨 |
| `test/unit/parser-proxy.test.ts` | 18 | /status, /self-test 파싱 | ✅ 구현됨 |
| `test/integration/proxy-routes.test.ts` | 232 | 라우트 통합 (MockAdapter) | ✅ 구현됨 |

> **Gap 분석**: Transport 구현(Direct/API/CLI), 실제 API 응답 파싱, 스트리밍 상세, 에러 경로, Capability Guard 등의 테스트가 미구현.

---

## 2. Codex Provider 테스트

### 2.1 CodexAdapter

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CX-A-01 | adapter 생성 | Unit | `new CodexAdapter(config)` 정상 초기화 | `provider === "codex"` |
| CX-A-02 | getStatus() — 토큰 유효 | Unit | 유효한 auth.json 존재 시 | `availability: "healthy"`, `primaryTransport: "direct"` |
| CX-A-03 | getStatus() — 토큰 부재 | Unit | auth.json 미존재 시 | `availability: "unavailable"`, `reason` 포함 |
| CX-A-04 | getCapabilities() | Unit | capability report 반환 | `selectedTransport: "direct"`, features 포함 |
| CX-A-05 | execute() 위임 | Unit | transport.execute() 호출 검증 | 동일 UnifiedResponse 반환 |
| CX-A-06 | stream() 위임 | Unit | transport.stream() 호출 검증 | 동일 chunk 시퀀스 yield |

### 2.2 CodexDirectTransport — 인증

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CX-D-01 | codex-cli auth.json 파싱 | Unit | `{auth_mode, tokens: {access_token, refresh_token}}` | `sourceFormat: "codex-cli"` |
| CX-D-02 | proxy tokens.json 파싱 | Unit | `{access_token, refresh_token, expires_at}` | `sourceFormat: "proxy"` |
| CX-D-03 | fallback 경로 우선순위 | Unit | `~/.codex/auth.json` → `~/.chatgpt-codex-proxy/tokens.json` | 주 경로 우선 |
| CX-D-04 | 토큰 만료 감지 | Unit | `expires_at < now + 5min` | `shouldRefreshCodexToken() === true` |
| CX-D-05 | 토큰 리프레시 요청 구성 | Unit | refresh_token → form body | `grant_type=refresh_token`, `client_id` 포함 |
| CX-D-06 | 인증 누락 시 에러 | Unit | auth 파일 없음 | `checkAvailability()` → `{ok: false}` |

### 2.3 CodexDirectTransport — 요청 빌드

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CX-D-10 | 단순 텍스트 프롬프트 | Unit | `{prompt: "hello"}` | `input: [{type:"message",role:"user",content:[{type:"input_text",text:"hello"}]}]` |
| CX-D-11 | messages 배열 변환 | Unit | 다중 user→assistant→user 턴 | 각 role 정확 매핑 |
| CX-D-12 | system instruction 추출 | Unit | messages에 system role 포함 | `instructions` 필드에 합산 |
| CX-D-13 | tool_call part → function_call | Unit | assistant의 tool_call part | `{type:"function_call",name,arguments}` |
| CX-D-14 | tool_result part → function_call_output | Unit | user의 tool_result part | `{type:"function_call_output",call_id,output}` |
| CX-D-15 | reasoning part → reasoning item | Unit | reasoning part 포함 시 | `{type:"reasoning",summary:[{type:"summary_text"}]}` |
| CX-D-16 | tools 배열 빌드 | Unit | `NormalizedToolDefinition[]` 입력 | `[{type:"function",name,description,parameters,strict}]` |
| CX-D-17 | json_schema responseFormat | Unit | `{type:"json_schema",schema,name,strict}` | Codex API의 `{type:"json_schema",...}` 포맷 |
| CX-D-18 | json_object responseFormat | Unit | `{type:"json_object"}` | `{type:"json_object"}` |
| CX-D-19 | text responseFormat (기본값) | Unit | responseFormat 미지정 | response_format 필드 없음 |

### 2.4 CodexDirectTransport — 실행 및 스트리밍

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CX-D-20 | execute() 정상 응답 | Integration | 텍스트만 응답 | `ok:true, text, parts:[{type:"text"}]` |
| CX-D-21 | execute() 도구 호출 응답 | Integration | tool_call 포함 응답 | `parts` 에 `tool_call` part, `finishReason: "tool_call"` |
| CX-D-22 | execute() 구조화 출력 응답 | Integration | json_schema 요청 → JSON 응답 | `parts` 에 `json` 또는 `text` part |
| CX-D-23 | stream() — delta 순서 | Integration | SSE `response.output_text.delta` 이벤트 | `start → delta(n개) → end` 순서 |
| CX-D-24 | stream() — tool_call 이벤트 | Integration | `response.output_item.added` (function_call) | `meta` chunk with `tool_call` part |
| CX-D-25 | stream() — reasoning 이벤트 | Integration | reasoning item 포함 시 | `meta` chunk with `reasoning` part |
| CX-D-26 | stream() — usage 포함 종료 | Integration | `response.completed` 이벤트 | `end` chunk with `usage` 필드 |
| CX-D-27 | execute() 401 에러 | Integration | 만료된 토큰 | `HttpStatusError(401)` → `toUnifiedError`: `auth_invalid` |
| CX-D-28 | execute() 429 에러 | Integration | rate limit | `rate_limited` 에러 코드 |
| CX-D-29 | execute() 타임아웃 | Integration | 응답 지연 | `AbortError` → `timeout` 코드 |
| CX-D-30 | stateContinuation 미지원 차단 | Unit | `state.previousResponseId` 포함 요청 | `assertStateSupport()` → throw |

---

## 3. Claude Provider 테스트

### 3.1 ClaudeAdapter — Fallback 체인

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-A-01 | 양쪽 transport 가용 | Unit | API+CLI 모두 사용 가능 | `availability: "healthy"`, `primaryTransport: "api"`, `fallbackTransport: "cli"` |
| CL-A-02 | API만 가용 | Unit | CLI 없음 | `primaryTransport: "api"`, `fallbackTransport: null` |
| CL-A-03 | CLI만 가용 (degraded) | Unit | 토큰 없음, CLI 있음 | `availability: "degraded"`, `primaryTransport: "cli"` |
| CL-A-04 | 양쪽 불가 | Unit | 토큰 없음, CLI 없음 | `availability: "unavailable"` |
| CL-A-05 | execute() — API 성공 | Unit | API transport 정상 | API transport의 응답 반환 |
| CL-A-06 | execute() — API 실패 → CLI 성공 | Unit | API throw → CLI 성공 | CLI transport의 응답 반환 |
| CL-A-07 | execute() — 양쪽 실패 | Unit | 양쪽 모두 throw | 마지막 에러 throw |
| CL-A-08 | stream() — API 성공 | Unit | API stream 정상 yield | API chunk 시퀀스 |
| CL-A-09 | stream() — API 에러 (yield 전) → CLI | Unit | 첫 chunk 전 API 에러 | CLI pseudo-stream 으로 fallback |
| CL-A-10 | stream() — API 에러 (yield 후) | Unit | 일부 chunk yield 후 에러 | 에러 throw (fallback 불가 — 이미 클라이언트에 전달) |

### 3.2 ClaudeApiTransport — 인증

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-D-01 | CLAUDE_CODE_OAUTH_TOKEN 존재 | Unit | 환경변수 설정 | `checkAvailability()` → `{ok: true}` |
| CL-D-02 | CLAUDE_CODE_OAUTH_TOKEN 미설정 | Unit | 환경변수 없음 | `{ok: false, reason: "missing ..."}` |

### 3.3 ClaudeApiTransport — 요청 빌드

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-D-10 | 기본 텍스트 메시지 | Unit | `messages:[{role:"user",parts:[text]}]` | Anthropic `{messages:[{role:"user",content:[{type:"text"}]}]}` |
| CL-D-11 | system instruction 분리 | Unit | system role 메시지 | `system` 필드로 분리 |
| CL-D-12 | 이미지 (base64) 변환 | Unit | `{type:"image",dataUrl:"data:image/png;base64,..."}` | Anthropic `{type:"image",source:{type:"base64",...}}` |
| CL-D-13 | 이미지 (URL) 변환 | Unit | `{type:"image",url:"https://..."}` | Anthropic `{type:"image",source:{type:"url",...}}` |
| CL-D-14 | tool_call → tool_use 매핑 | Unit | assistant의 tool_call part | `{type:"tool_use",id,name,input}` |
| CL-D-15 | tool_result 매핑 | Unit | user의 tool_result part | `{type:"tool_result",tool_use_id,content}` |
| CL-D-16 | tool_result (error) | Unit | `isError: true` | `{type:"tool_result",is_error:true}` |
| CL-D-17 | tool_choice 매핑 | Unit | `{mode:"any"}` 등 | Anthropic `tool_choice` 포맷 매핑 |

### 3.4 ClaudeApiTransport — Hosted Tools

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-D-20 | web_search hosted tool | Integration | `hostedTools:[{type:"web_search"}]` | `{type:"web_search_20250305"}`, beta header 포함 |
| CL-D-21 | code_execution hosted tool | Integration | `hostedTools:[{type:"code_execution"}]` | `{type:"code_execution_20250825"}`, beta header 포함 |
| CL-D-22 | computer_use hosted tool | Integration | `hostedTools:[{type:"computer_use"}]` | `{type:"computer_20250124"}`, beta header 포함 |
| CL-D-23 | hosted + custom tools 혼합 | Integration | 두 종류 동시 | tools 배열에 양쪽 모두 포함 |

### 3.5 ClaudeApiTransport — Structured Output Shim

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-D-30 | json_schema 요청 시 shim 주입 | Unit | `responseFormat:{type:"json_schema",schema:{...}}` | tools에 `emit_json` 도구 추가, `tool_choice:{type:"any"}` |
| CL-D-31 | json_object 요청 시 shim 주입 | Unit | `responseFormat:{type:"json_object"}` | tools에 `emit_json(any JSON)` 추가 |
| CL-D-32 | shim 응답 → json part 변환 | Unit | 응답에 `tool_use(emit_json)` | `parts`에 `{type:"json",value:{...}}` |
| CL-D-33 | shim + 기존 도구 병존 | Unit | custom tools + json_schema | tools 배열에 custom + emit_json |

### 3.6 ClaudeApiTransport — 실행 및 스트리밍

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-D-40 | execute() 텍스트 응답 | Integration | 정상 non-stream | `ok:true, text, finishReason:"stop"` |
| CL-D-41 | execute() tool_use 응답 | Integration | stop_reason=tool_use | `finishReason:"tool_call"`, parts에 tool_call |
| CL-D-42 | execute() usage 포함 | Integration | input/output_tokens | `usage:{inputTokens,outputTokens}` |
| CL-D-43 | stream() 이벤트 순서 | Integration | Anthropic SSE 시퀀스 | `start → delta(n) → end` |
| CL-D-44 | stream() tool_use 이벤트 | Integration | content_block_start(tool_use) | meta chunk with tool_call data |
| CL-D-45 | stream() input_json_delta | Integration | tool input 증분 | 누적 후 최종 argumentsJson |
| CL-D-46 | stream() reasoning 이벤트 | Integration | thinking block | meta chunk with reasoning |
| CL-D-47 | execute() 401 에러 | Integration | 만료 토큰 | `auth_invalid` 에러 |
| CL-D-48 | execute() overloaded (529) | Integration | 서버 과부하 | `provider_error` with 상세 메시지 |

### 3.7 ClaudeCliTransport

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CL-C-01 | checkAvailability() — CLI 존재 | Unit | `claude` 바이너리 PATH에 존재 | `{ok: true}` |
| CL-C-02 | checkAvailability() — CLI 미설치 | Unit | `claude` 바이너리 없음 | `{ok: false, reason: "claude CLI not found"}` |
| CL-C-03 | execute() — 정상 텍스트 응답 | Integration | `claude -p "hello" --output-format json` | `{ok:true, text:"...", transport:"cli"}` |
| CL-C-04 | execute() — messages → prompt 변환 | Unit | messages 배열 → `collapseMessagesToPrompt()` | `SYSTEM:\n...\nUSER:\n...` 형식 |
| CL-C-05 | execute() — system instruction 포함 | Unit | system 메시지 포함 시 | prompt에 `SYSTEM:` 블록 포함 |
| CL-C-06 | execute() — 잘못된 응답 json | Integration | stdout이 비정상 | `throw Error("invalid provider response")` |
| CL-C-07 | execute() — tool 요청 시 차단 | Unit | `tools:[]` 포함 요청 | `assertTransportSupportsRequest()` → throw `unsupported_feature` |
| CL-C-08 | execute() — 이미지 요청 시 차단 | Unit | image part 포함 | throw `unsupported_feature` |
| CL-C-09 | stream() — pseudo-stream | Unit | execute() 래핑 | `start → delta(전체텍스트) → end` 3개 chunk |
| CL-C-10 | execute() — macOS pseudo-TTY | Unit | darwin 환경 | `script -q /dev/null` 명령어 래핑 |

---

## 4. Gemini Provider 테스트

### 4.1 GeminiAdapter — Fallback 체인

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| GM-A-01 | 양쪽 transport 가용 | Unit | CodeAssist+CLI 사용 가능 | `availability: "healthy"`, `primaryTransport: "code-assist"` |
| GM-A-02 | CodeAssist만 가용 | Unit | CLI 없음 | `fallbackTransport: null` |
| GM-A-03 | CLI만 가용 (degraded) | Unit | OAuth 실패, CLI 있음 | `availability: "degraded"`, `primaryTransport: "cli"` |
| GM-A-04 | 양쪽 불가 | Unit | 양쪽 실패 | `availability: "unavailable"` |
| GM-A-05 | execute() fallback 동작 | Unit | CodeAssist 실패 → CLI 성공 | CLI 응답 반환 |
| GM-A-06 | stream() fallback — yield 전 실패 | Unit | CodeAssist 첫 chunk 전 에러 | CLI pseudo-stream |
| GM-A-07 | stream() fallback — yield 후 실패 | Unit | 일부 chunk 후 에러 | throw (fallback 불가) |

### 4.2 GeminiCodeAssistTransport — 인증 & 프로젝트

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| GM-D-01 | OAuth 자격증명 파싱 | Unit | `oauth_creds.json` 정상 | access_token, refresh_token 추출 |
| GM-D-02 | 자격증명 만료 감지 | Unit | `expiry_date < now` | `isGeminiCredentialExpired()` → true |
| GM-D-03 | 자격증명 갱신 병합 | Unit | 새 access_token + 기존 refresh_token | refresh_token 보존 |
| GM-D-04 | 설정에 projectId 지정 시 | Unit | `TUI_GEMINI_PROJECT` 환경변수 | 직접 사용, 탐색 생략 |
| GM-D-05 | projectId 자동 탐색 — loadCodeAssist | Integration | 기존 프로젝트 존재 | 첫 번째 발견된 프로젝트 사용 |
| GM-D-06 | projectId 자동 탐색 — 프로젝트 목록 | Integration | loadCodeAssist 실패 | `listAccessibleProjectIds()` 시도 |
| GM-D-07 | projectId 자동 온보딩 | Integration | 서비스 미활성 | `onboardProject()` → 활성화 URL 호출 → 프로젝트 반환 |
| GM-D-08 | 프로젝트 ID 캐싱 | Unit | 두 번째 호출 | 탐색 로직 재실행 안 함 |
| GM-D-09 | OAuth 파일 미존재 | Unit | `~/.gemini/oauth_creds.json` 없음 | `checkAvailability()` → `{ok:false}` |

### 4.3 GeminiCodeAssistTransport — 요청 빌드

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| GM-D-10 | 대화 메시지 변환 | Unit | user/assistant → model 롤 | `{role:"user"/"model",parts:[{text}]}` |
| GM-D-11 | system instruction 추출 | Unit | system role 메시지 | `system_instruction.parts[0].text` 포함 |
| GM-D-12 | 요청 body 구조 | Unit | model, contents, config | `{model, contents, generationConfig, systemInstruction}` |

### 4.4 GeminiCodeAssistTransport — 실행 및 스트리밍

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| GM-D-20 | execute() 정상 | Integration | Code Assist API 호출 | `ok:true, text, transport:"code-assist"` |
| GM-D-21 | execute() 다중 파트 응답 | Integration | 여러 candidate parts | 텍스트 합산 |
| GM-D-22 | stream() — delta 순서 | Integration | SSE 응답 파싱 | `start → delta(n) → end` |
| GM-D-23 | execute() 401 — 토큰 갱신 필요 | Integration | OAuth 만료 | 에러 또는 자동 갱신 |
| GM-D-24 | execute() 서비스 비활성 | Integration | 프로젝트 서비스 off | 에러 메시지 + 활성화 URL |

### 4.5 GeminiCliTransport

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| GM-C-01 | checkAvailability() — CLI 존재 | Unit | `gemini` 바이너리 PATH에 존재 | `{ok: true}` |
| GM-C-02 | checkAvailability() — CLI 미설치 | Unit | `gemini` 바이너리 없음 | `{ok: false, reason: "gemini CLI not found"}` |
| GM-C-03 | execute() — 정상 응답 | Integration | `gemini -p "hello" -o json` | `{ok:true, text, transport:"cli"}` |
| GM-C-04 | execute() — ANSI 코드 제거 | Unit | ANSI 이스케이프 포함 stdout | 깨끗한 텍스트 |
| GM-C-05 | execute() — JSON 추출 fallback | Unit | 접두사 노이즈 + JSON | 첫 `{` ~ 마지막 `}` 파싱 |
| GM-C-06 | execute() — tool 요청 시 차단 | Unit | tools 포함 요청 | throw `unsupported_feature` |
| GM-C-07 | stream() — pseudo-stream | Unit | execute() 래핑 | `start → delta → end` 시퀀스 |

---

## 5. Cross-Provider 공통 테스트

### 5.1 Capability Guard

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CP-G-01 | 지원하지 않는 feature 차단 | Unit | transport `none` + 요청에 해당 feature | throw `unsupported_feature` |
| CP-G-02 | 지원하는 feature 통과 | Unit | transport `full` + 동일 feature 요청 | 정상 통과 |
| CP-G-03 | partial feature 통과 | Unit | transport `partial` | 정상 통과 (none만 차단) |
| CP-G-04 | inferRequestedFeatures — messages | Unit | messages 배열 존재 | features에 "messages" |
| CP-G-05 | inferRequestedFeatures — streaming | Unit | `stream: true` | features에 "streaming" |
| CP-G-06 | inferRequestedFeatures — tools | Unit | tools 배열 존재 | features에 "toolCalling" |
| CP-G-07 | inferRequestedFeatures — hostedTools | Unit | hostedTools 존재 | features에 "hostedTools" |
| CP-G-08 | inferRequestedFeatures — image | Unit | image part 포함 | features에 "imageInput" |
| CP-G-09 | inferRequestedFeatures — structuredOutput | Unit | `responseFormat.type!="text"` | features에 "structuredOutput" |
| CP-G-10 | inferRequestedFeatures — stateContinuation | Unit | state.previousResponseId | features에 "stateContinuation" |
| CP-G-11 | effectiveSupport 계산 | Unit | platform=full, transport=partial | effective=partial |
| CP-G-12 | effectiveSupport — none 우선 | Unit | platform=full, transport=none | effective=none |

### 5.2 에러 정규화

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CP-E-01 | HttpStatusError(401) → auth_invalid | Unit | status 401 | code: "auth_invalid" |
| CP-E-02 | HttpStatusError(429) → rate_limited | Unit | status 429 | code: "rate_limited" |
| CP-E-03 | HttpStatusError(403) → provider_error | Unit | status 403 + bodyText | code: "provider_error", message 포함 |
| CP-E-04 | AbortError → timeout | Unit | AbortError 인스턴스 | code: "timeout" |
| CP-E-05 | "not found" → transport_unavailable | Unit | 메시지에 "not found" | code: "transport_unavailable" |
| CP-E-06 | "not supported" → unsupported_feature | Unit | 메시지에 "not supported" | code: "unsupported_feature" |
| CP-E-07 | UnifiedProxyError 통과 | Unit | 기존 UnifiedProxyError | 그대로 반환 |
| CP-E-08 | unknown 에러 | Unit | `throw 42` 같은 비표준 | code: "provider_error", message: "unknown error" |

### 5.3 Human Input 인터셉션

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CP-H-01 | computer_use 감지 | Unit | hostedTools에 computer_use | HumanInputRequest 반환 |
| CP-H-02 | remote_mcp 감지 | Unit | hostedTools에 remote_mcp | HumanInputRequest 반환 |
| CP-H-03 | web_search — 비대화형 | Unit | hostedTools에 web_search만 | undefined 반환 (차단 안 함) |
| CP-H-04 | humanInputMode=return | Unit | return 모드 + interactive tool | 에러 응답에 humanInput payload |
| CP-H-05 | humanInputMode=forbid | Unit | forbid 모드 | throw (fail-fast) |
| CP-H-06 | humanInputMode 미지정 | Unit | 기본값 + interactive tool | throw (fail-fast) |

### 5.4 메시지 정규화

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CP-N-01 | prompt → messages 변환 | Unit | prompt string만 제공 | `[{role:"user",parts:[text]}]` |
| CP-N-02 | messages 우선 | Unit | prompt + messages 동시 | messages 사용 |
| CP-N-03 | 빈 요청 | Unit | prompt/messages 둘 다 없음 | 빈 배열 |
| CP-N-04 | collapseMessagesToPrompt | Unit | 다중 메시지 | `SYSTEM:\n...\nUSER:\n...\nASSISTANT:\n...` |
| CP-N-05 | extractTextFromParts — mixed | Unit | text+json+tool_result+reasoning | 모든 텍스트 합산 |
| CP-N-06 | filterChatMessages | Unit | system+user+assistant | system 제외된 결과 |

---

## 6. Proxy 라우트 통합 테스트

### 6.1 Health & Status

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| PR-H-01 | GET /api/v1/health | Integration | 서버 기동 후 | `{ok:true}` |
| PR-H-02 | GET /api/v1/providers | Integration | 3개 provider 등록 | `providers.length === 3` |
| PR-H-03 | GET /api/v2/capabilities | Integration | 전체 capability | 3개 provider reports |
| PR-H-04 | GET /api/v2/capabilities/:provider | Integration | codex만 | 1개 report |
| PR-H-05 | 404 — 미정의 경로 | Integration | `GET /unknown` | `{error: "not found"}` |

### 6.2 v1 Chat/Batch

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| PR-V1-01 | POST /api/v1/chat — 성공 | Integration | codex + prompt | `{text: "codex:...", transport}` |
| PR-V1-02 | POST /api/v1/chat — prompt 누락 | Integration | body 비어있음 | 400 에러 |
| PR-V1-03 | POST /api/v1/batch — 복수 | Integration | codex+claude | `results.length === 2`, 순서 보장 |
| PR-V1-04 | POST /api/v1/batch — 전체 | Integration | providers 미지정 | 3개 전부 |
| PR-V1-05 | POST /api/v1/self-test | Integration | 스모크 테스트 | `ok: true/false` per provider |

### 6.3 v2 Chat/Batch

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| PR-V2-01 | POST /api/v2/chat — messages | Integration | messages 배열 | `text, parts` 포함 응답 |
| PR-V2-02 | POST /api/v2/chat — responseFormat | Integration | json_object | 정상 처리 |
| PR-V2-03 | POST /api/v2/chat — humanInput 반환 | Integration | computer_use + return | `{ok:false, error.code:"human_input_required", humanInput}` |
| PR-V2-04 | POST /api/v2/batch — 다중 | Integration | codex+gemini | results 배열 |

### 6.4 Streaming 라우트

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| PR-S-01 | POST /api/v1/chat/stream | Integration | SSE 헤더 + 이벤트 | `Content-Type: text/event-stream` |
| PR-S-02 | POST /api/v2/chat/stream | Integration | v2 스트리밍 | chunk → delta → end SSE |
| PR-S-03 | POST /api/v1/batch/stream | Integration | 다중 provider SSE | 각 provider별 start/delta/end |
| PR-S-04 | POST /api/v2/batch/stream | Integration | v2 다중 스트리밍 | 병렬 이벤트 |

---

## 7. 호환성 API 테스트

### 7.1 Anthropic 매퍼 (`mapper-anthropic.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CM-A-01 | model → provider 추론 (claude-*) | Unit | `model:"claude-sonnet-4-5"` | `provider:"claude"` |
| CM-A-02 | model → provider 추론 (gpt-*) | Unit | `model:"gpt-5"` | `provider:"codex"` |
| CM-A-03 | model → provider 추론 (gemini-*) | Unit | `model:"gemini-2.5-pro"` | `provider:"gemini"` |
| CM-A-04 | metadata.provider 우선 | Unit | metadata에 provider 지정 | metadata 값 사용 |
| CM-A-05 | text+image content 변환 | Unit | text + base64 image | normalized message에 양쪽 포함 |
| CM-A-06 | tool_use → tool_call 변환 | Unit | type:tool_use | `{type:"tool_call",id,name,argumentsJson}` |
| CM-A-07 | tool_result 변환 | Unit | type:tool_result | `{type:"tool_result",id,content}` |
| CM-A-08 | system 정규화 — 문자열 | Unit | `system:"be concise"` | string |
| CM-A-09 | system 정규화 — 배열 | Unit | `system:[{type:"text",text}]` | 합산 string |
| CM-A-10 | hosted tools 분리 | Unit | web_search + computer_use | hostedTools 배열 + humanInputMode |
| CM-A-11 | 응답 역변환 — text parts | Unit | `parts:[{type:"text"}]` | `content:[{type:"text"}]` |
| CM-A-12 | 응답 역변환 — tool_call → tool_use | Unit | tool_call part | `{type:"tool_use",id,name,input}` |
| CM-A-13 | finishReason 매핑 | Unit | tool_call → tool_use | `stop_reason: "tool_use"` |

### 7.2 OpenAI 매퍼 (`mapper-openai.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CM-O-01 | Chat Completions 메시지 파싱 | Unit | messages 배열 | NormalizedMessage[] |
| CM-O-02 | developer role 매핑 | Unit | role:developer | 그대로 보존 |
| CM-O-03 | tool_calls 파싱 | Unit | assistant의 tool_calls[] | tool_call parts로 변환 |
| CM-O-04 | tool role 메시지 | Unit | role:tool + tool_call_id | tool_result part |
| CM-O-05 | response_format 매핑 | Unit | json_schema | `responseFormat:{type:"json_schema",...}` |
| CM-O-06 | Responses API input 파싱 | Unit | input 배열 | NormalizedMessage[] |
| CM-O-07 | hosted tools — web_search_preview | Unit | tools에 web_search_preview | `hostedTools:[{type:"web_search"}]` |
| CM-O-08 | hosted tools — computer_use_preview | Unit | tools에 computer_use_preview | `hostedTools:[{type:"computer_use"}]` |
| CM-O-09 | Chat Completion 응답 변환 | Unit | UnifiedResponse → choices | `choices[0].message.content` |
| CM-O-10 | Chat Completion — tool_calls 응답 | Unit | tool_call parts | `choices[0].message.tool_calls[]` |
| CM-O-11 | Responses API 응답 변환 | Unit | UnifiedResponse → output | `output[0].content[0].text` |
| CM-O-12 | Responses API — function_call 응답 | Unit | tool_call parts | `output[].type === "function_call"` |

### 7.3 Anthropic 스트리밍 라우트

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CM-AS-01 | SSE 이벤트 시퀀스 | Integration | stream=true | `message_start → content_block_start → delta → stop → message_delta → message_stop` |
| CM-AS-02 | tool_use 스트리밍 | Integration | tool_call chunk | `content_block_start(tool_use)` + `input_json_delta` |
| CM-AS-03 | human_input_required 시 409 | Integration | computer_use + return | HTTP 409 에러 응답 |

### 7.4 OpenAI 스트리밍 라우트

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CM-OS-01 | Chat Completions SSE | Integration | stream=true | `chat.completion.chunk` + `[DONE]` |
| CM-OS-02 | Chat Completions — tool_calls delta | Integration | tool stream | `delta.tool_calls[]` 포함 |
| CM-OS-03 | Responses API SSE | Integration | stream=true | `response.created → output_text.delta → response.completed` |
| CM-OS-04 | Responses API — function_call 이벤트 | Integration | tool stream | `response.output_item.added(function_call)` |

---

## 8. 공통 모듈 단위 테스트

### 8.1 SSE 파서 (`shared/sse.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| SS-01 | 기본 이벤트 파싱 | Unit | `event: x\ndata: y\n\n` | `{event:"x",data:"y"}` |
| SS-02 | 이벤트 타입 기본값 | Unit | `data: y\n\n` (event 없음) | `{event:"message",data:"y"}` |
| SS-03 | 다중 data 라인 | Unit | `data: a\ndata: b\n\n` | `{data:"a\nb"}` |
| SS-04 | CRLF boundary 처리 | Unit | `\r\n\r\n` 구분 | 정상 파싱 |
| SS-05 | 마지막 불완전 이벤트 | Unit | 스트림 끝 `\n` 없음 | 마지막 이벤트도 파싱 |
| SS-06 | formatSseEvent 출력 | Unit | event+data | `"event: name\ndata: json\n\n"` |

### 8.2 CLI 유틸 (`shared/cli.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CU-01 | commandExists — 존재하는 명령 | Unit | `ls` | true |
| CU-02 | commandExists — 없는 명령 | Unit | `nonexistent_cmd_xyz` | false |
| CU-03 | stripAnsi | Unit | ANSI 이스케이프 포함 | 깨끗한 텍스트 |
| CU-04 | extractJsonPayload — 깨끗한 JSON | Unit | `{"a":1}` | `{a:1}` |
| CU-05 | extractJsonPayload — 노이즈 + JSON | Unit | 접두 텍스트 + JSON | 정상 파싱 |
| CU-06 | extractJsonPayload — JSON 없음 | Unit | 비 JSON 텍스트 | null |
| CU-07 | runCliCommand — 타임아웃 | Integration | 지연 명령 | throw within timeoutMs |
| CU-08 | runCliCommand — maxBuffer | Unit | 대량 출력 | 10MB 이내 정상 |

### 8.3 Logger (`shared/logger.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| LG-01 | debug 레벨 — debug 출력 | Unit | level=debug, debug() | 출력됨 |
| LG-02 | info 레벨 — debug 미출력 | Unit | level=info, debug() | 출력 안 됨 |
| LG-03 | error 레벨 — info 미출력 | Unit | level=error, info() | 출력 안 됨 |
| LG-04 | fields 포맷팅 | Unit | `{a:1,b:"x"}` | `a=1 b="x"` |

### 8.4 Contracts (`proxy/contracts.ts`)

| ID | 테스트명 | 유형 | 설명 | 기대 결과 |
|---|---|---|---|---|
| CT-01 | parseContentPart — text | Unit | `{type:"text",text:"hi"}` | `{type:"text",text:"hi"}` |
| CT-02 | parseContentPart — image URL | Unit | `{type:"image",url:"..."}` | URL 포함 |
| CT-03 | parseContentPart — image dataUrl | Unit | `{type:"image",dataUrl:"data:..."}` | mimeType 추출 |
| CT-04 | parseContentPart — file | Unit | `{type:"file",url:"...",name}` | 파일 파트 |
| CT-05 | parseContentPart — tool_call | Unit | id, name, argumentsJson | 정확 매핑 |
| CT-06 | parseContentPart — tool_result | Unit | id, content, isError | 정확 매핑 |
| CT-07 | parseContentPart — reasoning | Unit | text, summary | reasoning 파트 |
| CT-08 | parseContentPart — citation | Unit | citationIndex, url | citation 파트 |
| CT-09 | parseMessages — role 필터 | Unit | 유효/비유효 role | 비유효 role 건너뜀 |
| CT-10 | parseTools — inputSchema 검증 | Unit | name + schema | NormalizedToolDefinition |
| CT-11 | parseHostedTools — type 검증 | Unit | web_search, code_execution | 유효 타입만 |
| CT-12 | parseResponseFormat — json_schema | Unit | name, schema, strict | 정확 매핑 |
| CT-13 | parseState — 전체 필드 | Unit | previousResponseId + cacheKey | 정확 매핑 |
| CT-14 | parseCapabilityPolicy | Unit | require + allowBestEffort | 정확 매핑 |
| CT-15 | parseRichUnifiedRequest — 최소 | Unit | provider + prompt만 | 정상 파싱 |
| CT-16 | parseRichUnifiedRequest — 전체 | Unit | 모든 필드 | 정상 파싱 |

---

## 부록: Provider별 Feature 지원 매트릭스

| Feature | Codex Direct | Claude API | Claude CLI | Gemini CodeAssist | Gemini CLI |
|---|---|---|---|---|---|
| messages | full | full | full | full | full |
| systemInstruction | partial | full | partial | full | partial |
| streaming | full | full | partial | full | partial |
| usage | full | full | none | partial | none |
| toolCalling | full | full | none | partial | none |
| hostedTools | none | full | none | none | none |
| imageInput | partial | full | none | partial | none |
| fileInput | none | full | none | partial | none |
| structuredOutput | full | partial(shim) | none | partial | none |
| reasoning | partial | full | none | none | none |
| citations | none | partial | none | partial | none |
| caching | partial | full | none | none | none |
| stateContinuation | partial | partial | none | none | none |

> **partial(shim)**: Claude API의 structuredOutput은 `emit_json` 도구를 통한 shim 방식으로 구현됨.
