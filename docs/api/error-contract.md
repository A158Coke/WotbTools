# API Error Contract

WotBTools 的 HTTP 错误使用统一、可版本化的 JSON envelope。错误码是机器可读契约；用户文案由前端 zh/en/ru locale 根据 `errorCode` 渲染，后端不返回 exception message、stack trace、token、请求体或回放内容。

## Canonical response

```json
{
  "id": "54c91ba3-b12d-4490-ae80-fdbd8f5bf508",
  "errorCode": "AUTH_FORBIDDEN",
  "errorMsg": null,
  "status": 403,
  "retryable": false,
  "details": {},
  "timestamp": "2026-08-30T17:00:00Z"
}
```

`id`/`errorCode`/`status`/`retryable`/`details`/`timestamp` 必填；`errorMsg` 可选（nullable）。`details` 必须是对象；无安全、稳定、可操作的结构化信息时返回空对象。HTTP status 必须与 `body.status` 相同。

- `id` 是本次错误的唯一标识：typed `ApiException` 返回其异常实例 id（同时写进后端日志 `id=`），非 typed/security/legacy 错误返回请求关联 id（等于响应头 `X-Request-ID`）。用户截图这个 id 给开发者后，后端日志可按同一个 id 检索到具体异常与请求。
- `errorCode` 是稳定机器码；infra 错误直接取 `ApiErrorCode` enum 名，legacy domain code 保留稳定大写字符串码（Phase 1 边界）。
- `X-Request-ID` 响应头保留，作为请求级关联（与 `RequestIdFilter` 的 `requestId`/`traceId` 一致），但不与 body 的 `id` 重复——body 用唯一的错误 `id`。

客户端分支只使用 `errorCode`、`status`、`retryable` 和明确的 `details` 字段；文案由前端按 `errorCode -> i18n` 渲染，后端不返回 `messageKey`。

## Backend model

新路径使用 `ApiException`，其内部架构为：

| 字段 | 类型 | 用途 |
|---|---|---|
| `id` | UUID string | 单个异常实例的内部诊断 ID |
| `errorCode` | `ApiErrorCode` enum | 稳定错误语义及默认 HTTP status/retryable |
| `errorMsg` | nullable string | 可选的安全诊断说明；为空时日志用异常 `id` |

`id` 进入响应与安全日志（用户把响应里的 `id` 交给开发者，后端日志 `id=` 可直接检索到同一异常实例）；`errorMsg` 是可选安全诊断说明，可进入响应与日志。对外不再使用 body 级 `traceId`（改由唯一错误 `id` 承担）。Phase 1 继续接收既有 domain exception 与稳定字符串码，由 `GlobalExceptionHandler` 适配成同一 envelope；后续按域逐步迁移成 typed exception。

Spring Security 不经过 MVC advice，因此 401/403 分别由 canonical `AuthenticationEntryPoint` / `AccessDeniedHandler` 写入同一 schema，同时保留 Bearer challenge/insufficient-scope headers。

## Infrastructure registry

| errorCode | status | retryable | category | usage |
|---|---:|:---:|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | false | authentication | 未登录、token 缺失/无效/过期 |
| `AUTH_FORBIDDEN` | 403 | false | authorization | 已登录但角色或资源权限不足 |
| `INVALID_ARGUMENT` | 400 | false | validation | 参数值/类型不合法 |
| `MISSING_PARAM` | 400 | false | validation | 必填 request parameter 缺失 |
| `INVALID_REQUEST` | 400 | false | validation | JSON、Bean Validation 或请求结构不合法 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | false | protocol | Content-Type 不支持 |
| `METHOD_NOT_ALLOWED` | 405 | false | protocol | HTTP method 不支持 |
| `RESOURCE_NOT_FOUND` | 404 | false | resource | 通用资源不存在 |
| `REPLAY_BUSY` | 503 | true | capacity | Replay worker 暂时繁忙 |
| `PROCESSING_QUEUE_FULL` | 503 | true | capacity | Processing queue 已满 |
| `EXPORT_QUEUE_FULL` | 503 | true | capacity | Export queue 已满 |
| `AI_REVIEW_BUSY` | 503 | true | capacity | AI Review worker 暂时繁忙 |
| `INTERNAL_ERROR` | 500 | true | internal | 未分类服务端异常 |
| `DATASET_REFERENCE_REQUIRED` | 400 | false | validation | Playback/AI Dataset reference 缺失 |

既有 Replay、AI、Profile、HoF、Boost、Admin domain codes 在 Phase 1 保持 errorCode/status 兼容，并统一获得 `id`、`errorCode`、`retryable`、`details` 与 `timestamp`。`ApiErrorCode` 是从 OpenAPI 生成的 known-server registry，不会把 `NETWORK_ERROR`、`REQUEST_ABORTED`、`MALFORMED_ERROR_RESPONSE`、`UNKNOWN_ERROR` 或 `HTTP_<status>` 等浏览器/application fallback 当成服务端码；`ApiError.errorCode` 仍保持 string，以容纳尚未注册的稳定 legacy domain code。新增 error code 必须同时更新 registry、后端测试与三语前端 locale；禁止为不同语义复用同一 errorCode。

## Frontend contract

HTTP boundary 直接使用生成的 `components['schemas']['ApiError']` wire type。parser 先按该 schema 校验 canonical response，再适配为前端 `ApiError` application model；application model 可以保留 nullable `status`、legacy correlation compatibility 与 client-local synthetic code，但这些字段/码不反向放宽或污染 OpenAPI wire contract。所有 API transport failure 最终规范化为 `ApiError`：

1. 优先解析 canonical `errorCode` 及其全部字段。
2. 兼容 legacy `{ "error": "CODE" }` 和纯稳定大写错误码文本。
3. 空 body、HTML proxy body、坏 JSON 依 HTTP status 映射稳定 fallback。
4. fetch `TypeError` 映射 `NETWORK_ERROR`；`AbortError` 映射 `REQUEST_ABORTED`。
5. feature panel 用 `apiErrorLabel` 展示本地化文案与诊断 ID（`errorCode -> i18n`，`id` 作为诊断 ID）；Retry 只由 `retryable` 驱动。局部错误不自动升级成全局 dialog。

Processing/Export Job 的 legacy `errorCode` 通过 `normalizeJobError` 进入相同 presentation，禁止继续添加 per-code `if/else`。

Capability `UNAVAILABLE`/HTTP 204 表示数据不足或功能不可用，不得伪装成 5xx；Battle Playback 明确区分未登录、权限不足、网络问题、服务端错误与 capability unavailable。

## Logging and tracing

- `RequestIdFilter` 继承或生成最多 128 字符的安全 `X-Request-ID`，写入 request attribute 及 MDC 的 `requestId`/`traceId`。
- handled 4xx 以无 stack trace 的 INFO 记录；5xx 以 ERROR 记录完整 stack trace，并包含 `traceId`（请求关联）、错误 `id`（= 响应 body 的 id）、`errorCode`、status、method、path、errorMsg。
- 用户把错误响应里的 `id` 交给开发者后，可在日志中用 `id=<value>` 检索到同一异常实例（typed `ApiException` 的异常 id）或同一请求（非 typed/security/legacy 的请求关联 id）。
- client disconnect/broken pipe 保持 WARN，避免产生误导性 5xx response 和 ERROR stack trace。
- 不记录 Authorization、token、API key、密码、用户上传内容、完整 prompt/AI response 或自由格式请求体。

## Phase 1 migration boundary

完成的 vertical slice：canonical MVC/Security envelope、request correlation、frontend parser/presentation、Battle Playback 角色 matcher 与 401/403/500/network/unavailable 展示、AI Review error presentation、Processing/Export Job normalization。

静态 inventory（2026-08-30）：`wotb-web` 仍有 39 个文件抛出 `IllegalArgumentException`、15 个文件抛出 `IllegalStateException`、21 个文件引用 `ResponseStatusException`。这些 legacy 路径由 Phase 1 adapter 保持兼容，按 Replay → AI → Profile/User → HoF → Boost → Admin 顺序在后续 PR 类型化；不在基础设施 PR 中重写 decoder、timeline、HP、地图重建、Rating 或 Android ingress。
