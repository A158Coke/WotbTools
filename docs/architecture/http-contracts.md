# HTTP Contract Infrastructure

## Authority and boundaries

`contracts/http/openapi.yaml` 是 WotBTools FE ↔ BE HTTP wire contract 的唯一事实源。它描述实际序列化后的 JSON、HTTP status、required/nullable 字段和稳定 enum；它不是 Java domain model、不是前端 view model，也不是运行时 schema registry。

边界保持分离：

- `java/wotb-core` 继续拥有 replay domain truth；Web 层通过显式 mapper 投影到 HTTP DTO。
- `java/wotb-contracts` 继续只负责 Control ↔ Worker async contract，不与公开 Web API 合并。
- Vue 组件消费 generated transport types，经 adapter/runtime validation 后再进入 view/application model。

## Generation and validation

修改 OpenAPI 后，在 `frontend/` 执行：

```bash
npm run api:lint
npm run api:generate
npm run api:check
npm run api:fixture
```

`api:generate` 生成 `src/api/generated/http-contract.ts`、Playback JSON Schema 和 error-code registry；生成文件不得手改。`api:check` 通过重新生成并检查 git diff，作为 drift gate。`api:fixture` 使用生产形状 fixture 验证 required、nullable、enum 和 `$ref`。运行时 Ajv 校验只在 HTTP 边界报告安全诊断元数据，不把响应体、token 或 schema 内部细节展示给用户。

标准迁移顺序是：

```text
OpenAPI → generated FE transport → BE serialization/mapper → runtime validation
        → adapter/view → contract tests → affected feature tests → PR CI
```

不生成 Java DTO、完整前端 API client 或 Android model；这能避免 codegen 与真实分层形成第二个 authority。

## Compatibility rules

- Domain enum 与 wire enum 必须显式映射。Playback 的 `DecodeConfidence` 只能通过 mapper 转为 `HIGH/MEDIUM/LOW/UNKNOWN`；FE 不得同时接受两套值来掩盖 producer violation。
- 旧 persisted playback artifact 只在 `ReplayArtifactWriter` 读取边界做有限、可证明的 normalization；新写入和 live HTTP response 必须直接符合 OpenAPI。
- `204` 表示 capability unavailable，不是 JSON schema failure；`200` response 无法通过 schema 才是 transport contract failure。
- ApiError 使用统一 envelope：稳定 `errorCode`、HTTP/body status、`retryable`、安全 `details`、timestamp 与诊断 `id`。SSE 是另一种传输形状，后续单独建模，不把它伪装成 JSON response。

## Review checklist

涉及 HTTP shape 的 PR 必须说明 authoritative source、生成产物、序列化测试、runtime/fixture 验证和兼容性边界；同时检查是否新增了重复手写 transport interface、domain enum 泄漏、required/nullable 漂移或把客户端 fallback code 当成服务端 error registry。
