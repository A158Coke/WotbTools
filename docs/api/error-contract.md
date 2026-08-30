# API Error Contract

WotBTools 的 HTTP 错误使用统一、可版本化的 JSON envelope。错误码是机器可读契约；用户文案由前端 zh/en/ru locale 根据 `messageKey` 或 `code` 渲染，后端不返回 exception message、stack trace、token、请求体或回放内容。

## Canonical response

```json
{
  "code": "AUTH_FORBIDDEN",
  "status": 403,
  "messageKey": "errors.auth_forbidden",
  "traceId": "54c91ba3-b12d-4490-ae80-fdbd8f5bf508",
  "retryable": false,
  "details": {},
  "timestamp": "2026-08-30T17:00:00Z"
}
```

所有字段必填。`details` 必须是对象；无安全、稳定、可操作的结构化信息时返回空对象。HTTP status 必须与 `body.status` 相同。`X-Request-ID` 响应头必须与 `body.traceId` 相同。

`messageKey` 是展示提示，不是业务分支条件。客户端分支只使用 `code`、`status`、`retryable` 和明确的 `details` 字段。

## Backend model

新路径使用 `ApiException`，其内部架构为：

| 字段 | 类型 | 用途 |
|---|---|---|
| `id` | UUID string | 单个异常实例的内部诊断 ID |
| `errorCode` | `ApiErrorCode` enum | 稳定错误语义及默认 HTTP status/retryable |
| `errorMsg` | nullable string | 可选的安全诊断说明；为空时日志用异常 `id` |

`id` 与 `errorMsg` 只进入安全日志，绝不直接进入响应。对外关联使用请求级 `traceId`。Phase 1 继续接收既有 domain exception 与稳定字符串码，由 `GlobalExceptionHandler` 适配成同一 envelope；后续按域逐步迁移成 typed exception。

Spring Security 不经过 MVC advice，因此 401/403 分别由 canonical `AuthenticationEntryPoint` / `AccessDeniedHandler` 写入同一 schema，同时保留 Bearer challenge/insufficient-scope headers。

## Infrastructure registry

| code | status | messageKey | retryable | category | usage |
|---|---:|---|:---:|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | `errors.auth_unauthenticated` | false | authentication | 未登录、token 缺失/无效/过期 |
| `AUTH_FORBIDDEN` | 403 | `errors.auth_forbidden` | false | authorization | 已登录但角色或资源权限不足 |
| `INVALID_ARGUMENT` | 400 | `errors.invalid_argument` | false | validation | 参数值/类型不合法 |
| `MISSING_PARAM` | 400 | `errors.missing_param` | false | validation | 必填 request parameter 缺失 |
| `INVALID_REQUEST` | 400 | `errors.invalid_request` | false | validation | JSON、Bean Validation 或请求结构不合法 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `errors.unsupported_media_type` | false | protocol | Content-Type 不支持 |
| `METHOD_NOT_ALLOWED` | 405 | `errors.method_not_allowed` | false | protocol | HTTP method 不支持 |
| `RESOURCE_NOT_FOUND` | 404 | `errors.resource_not_found` | false | resource | 通用资源不存在 |
| `REPLAY_BUSY` | 503 | `errors.replay_busy` | true | capacity | Replay worker 暂时繁忙 |
| `PROCESSING_QUEUE_FULL` | 503 | `errors.processing_queue_full` | true | capacity | Processing queue 已满 |
| `EXPORT_QUEUE_FULL` | 503 | `errors.export_queue_full` | true | capacity | Export queue 已满 |
| `AI_REVIEW_BUSY` | 503 | `errors.ai_review_busy` | true | capacity | AI Review worker 暂时繁忙 |
| `INTERNAL_ERROR` | 500 | `errors.internal_error` | true | internal | 未分类服务端异常 |

既有 Replay、AI、Profile、HoF、Boost、Admin domain codes 在 Phase 1 保持 code/status 兼容，并统一获得 `messageKey=errors.<lowercase-code>`、`traceId`、`retryable`、`details` 与 `timestamp`。新增 error code 必须同时更新 registry、后端测试与三语前端 locale；禁止为不同语义复用同一 code。

## Frontend contract

所有 API transport failure 最终规范化为 `ApiError`：

1. 优先解析 canonical `code` 及其全部字段。
2. 兼容 legacy `{ "error": "CODE" }` 和纯稳定大写错误码文本。
3. 空 body、HTML proxy body、坏 JSON 依 HTTP status 映射稳定 fallback。
4. fetch `TypeError` 映射 `NETWORK_ERROR`；`AbortError` 映射 `REQUEST_ABORTED`。
5. feature panel 用 `apiErrorLabel` 展示本地化文案与诊断 ID；Retry 只由 `retryable` 驱动。局部错误不自动升级成全局 dialog。

Processing/Export Job 的 legacy `errorCode` 通过 `normalizeJobError` 进入相同 presentation，禁止继续添加 per-code `if/else`。

Capability `UNAVAILABLE`/HTTP 204 表示数据不足或功能不可用，不得伪装成 5xx；Battle Playback 明确区分未登录、权限不足、网络问题、服务端错误与 capability unavailable。

## Logging and tracing

- `RequestIdFilter` 继承或生成最多 128 字符的安全 `X-Request-ID`，写入 request attribute 及 MDC 的 `requestId`/`traceId`。
- handled 4xx 以无 stack trace 的 INFO 记录；5xx 以 ERROR 记录完整 stack trace，并包含 `traceId`、内部 exception ID、code、status、method、path。
- client disconnect/broken pipe 保持 WARN，避免产生误导性 5xx response 和 ERROR stack trace。
- 不记录 Authorization、token、API key、密码、用户上传内容、完整 prompt/AI response 或自由格式请求体。

## Phase 1 migration boundary

完成的 vertical slice：canonical MVC/Security envelope、request correlation、frontend parser/presentation、Battle Playback 角色 matcher 与 401/403/500/network/unavailable 展示、AI Review error presentation、Processing/Export Job normalization。

静态 inventory（2026-08-30）：`wotb-web` 仍有 39 个文件抛出 `IllegalArgumentException`、15 个文件抛出 `IllegalStateException`、21 个文件引用 `ResponseStatusException`。这些 legacy 路径由 Phase 1 adapter 保持兼容，按 Replay → AI → Profile/User → HoF → Boost → Admin 顺序在后续 PR 类型化；不在基础设施 PR 中重写 decoder、timeline、HP、地图重建、Rating 或 Android ingress。
