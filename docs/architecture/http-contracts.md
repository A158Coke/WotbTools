# HTTP Contract Infrastructure

## Authority and boundaries

`contracts/http/openapi.yaml` 是 WotBTools FE ↔ BE HTTP wire contract 的唯一事实源。它描述实际序列化后的 JSON、HTTP status、required/nullable 字段和稳定 enum；它不是 Java domain model、不是前端 view model，也不是运行时 schema registry。

边界保持分离：

- 回放事实的权威是上游 Rust Core（客户端 WASM）；`java/wotb-core` 保留共享模型、参考数据与 AI 投影分析能力；业务 Web 层通过显式 mapper 投影到 HTTP DTO。
- `BattlePlaybackDataset` 等 schema component 在端点删除后保留，作为客户端本机数据的形状契约。
- Vue 组件消费 generated transport types，经 adapter/runtime validation 后再进入 view/application model。

## Generation and validation

修改 OpenAPI 后，在 `frontend/` 执行：

```bash
npm run api:lint
npm run api:generate
npm run api:check
npm run api:fixture
```

`api:generate` 生成 `src/api/generated/http-contract.ts`、Playback JSON Schema、error-code registry 与 Ajv standalone ESM validators；生成文件不得手改。`api:check` 通过重新生成并检查 git diff，作为 drift gate。`api:fixture` 使用生产形状 fixture 验证 required、nullable、enum 和 `$ref`。Ajv 只在生成时编译 schema，运行时执行 generated validator，不使用 eval/new Function，兼容 Android 严格 CSP。校验只在数据边界报告安全诊断元数据，不把响应体、token 或 schema 内部细节展示给用户。

生成脚本按显式 schema 名单导出运行时 validator；仅存在 generated TypeScript 类型不代表网络数据已经校验。用户资料/绑定、管理用户、公开单场榜、百场与三种名人堂批量删除，以及积分赛、推荐、联赛直播的 JSON 在各自 `src/api/` owner 内从 `unknown` 开始校验。JSON 语法错误与 schema 校验失败均映射为 `INVALID_RESPONSE`、`retryable=false`；取消和 transport 错误保留原语义。未纳入这些边界的 JSON 不因其它领域已接入 validator 而自动获得保护。

`contracts/http/fixtures/business-boundaries.json` 保存匿名固定的 DTO/mapper 序列化样本，`wotb-web` 的 `ApiContractTest` 对照真实 Java 生产类型验证字段与空值，`api:fixture` 对同一份样本验证 OpenAPI。API 单测通过真实响应体与 generated validator 验证调用接线，不 mock validator；数组在没有整包 validator 时使用数组检查与 generated item validator。合法 optional/nullable 字段不得在 wire 校验时填充默认值。

标准迁移顺序是：

```text
OpenAPI → generated FE transport → BE serialization/mapper → runtime validation
        → adapter/view → contract tests → affected feature tests → PR CI
```

不生成 Java DTO、完整前端 API client 或 Android model；这能避免 codegen 与真实分层形成第二个 authority。

## Compatibility rules

- 管理用户列表的 `profileCreatedAt` 按 RFC 3339 输出，producer 使用 `ISO_OFFSET_DATE_TIME` 保证整分钟时间也包含秒；不以省略秒的字符串放宽 `date-time` 契约。需要修正 producer 序列化时，先发布 producer，再发布依赖该契约的严格 consumer。

- Domain enum 与 wire enum 必须显式映射。客户端 Playback 投影输出契约中的 `HIGH/MEDIUM/LOW/UNKNOWN`，不得同时接受两套值来掩盖 producer violation。
- 服务端 Playback 端点、持久化 artifact 与 `ReplayArtifactWriter` 已退役；当前数据由客户端 `replay-local/playback` 生成并经 generated validator 校验。历史 artifact 的 normalization 不再是当前运行链路。
- HTTP status 按具体 endpoint 的 OpenAPI 定义解释：当前 `204` 可表示删除完成或 AI 取消成功，不能统一解释为 capability unavailable。旧 Playback HTTP 的 unavailable 已退役，当前本地 `dataset=null` / `overview=null` 与数据形状校验失败仍是不同状态；带 JSON 的成功响应无法通过对应 schema 才是 transport contract failure。
- ApiError 使用统一 envelope：稳定 `errorCode`、HTTP/body status、`retryable`、安全 `details`、timestamp 与诊断 `id`。SSE 是另一种传输形状，后续单独建模，不把它伪装成 JSON response。

## CORS

Web 由 nginx `/api/` 反代到 `BACKEND_UPSTREAM` 指定的 TX Business API，`/api/ai/` 使用独立 `AI_UPSTREAM`（`deploy/tx/nginx/frontend.conf.template`、`deploy/tx/frontend.compose.yml`），本地走 Vite dev proxy（`changeOrigin: true`）。Android bundled Vue 的文档 origin 是 `http://127.0.0.1:21653`（3.0 起，Native LocalRuntimeServer；2.x 为 `https://appassets.androidplatform.net`），业务请求由 `src/platform/runtime.js` 解析为 `https://wotbtools.com/api/**`，使用 Native Bearer，credentials 为 omit。

公共 ingress `deploy/tx/Caddyfile` 是这条跨源边界的唯一 CORS owner：精确的 Android 本机 origin（3.0+ loopback 与 2.x appassets 两个），允许实际 HTTP methods 及 Authorization/Content-Type/Content-Encoding/Accept；匿名 OPTIONS 在 proxy/auth 前直接返回 204，真实响应也携带 CORS，暴露 Content-Disposition/X-Request-ID/X-Map-Meta。不启用 credentialed CORS，也不新增 controller `@CrossOrigin` 或第二份 backend CORS 配置。固定 `/agent-assets/*` gateway 同样受此边界保护。发布前 readiness 探测验证 preflight、真实 profile 401 和 asset index JSON。

## Review checklist

涉及 HTTP shape 的 PR 必须说明 authoritative source、生成产物、序列化测试、runtime/fixture 验证和兼容性边界；同时检查是否新增了重复手写 transport interface、domain enum 泄漏、required/nullable 漂移或把客户端 fallback code 当成服务端 error registry。
