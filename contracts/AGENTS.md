# contracts/ — HTTP wire contract instructions

仓库级规则见 [`../.agents/AGENTS.md`](../.agents/AGENTS.md)。

- `http/openapi.yaml` 是 FE ↔ BE HTTP wire contract 的唯一事实源；修改后必须在 `frontend/` 运行 `npm run api:generate`。
- 这里描述序列化后的 HTTP shape，不承载 `wotb-core` domain 语义，也不替代 `java/wotb-contracts` 的 Control ↔ Worker contract。
- 新字段必须明确 `required`、nullable、enum、`$ref` 与兼容策略；不得把 internal exception 名称机械暴露为公共 error code。
- `frontend/src/api/generated/` 是生成产物，不手工编辑；fixture 必须使用生产形状且不得包含凭据、token 或用户回放内容。
- 修改 wire contract 时运行 `npm run api:lint`, `npm run api:check`, `npm run api:fixture` 及受影响的后端/前端测试。
- `mq/parser-messages.json` 是 RabbitMQ parser 协议的 JSON Schema（`parser.request` / `parser.result` / `parser.failed`），不是 HTTP contract。它的应用侧权威是 `java/wotb-broker-rabbitmq` 的 `ParserMessageCodec`，两者由该模块的 `ParserMessageContractTest` 互锁（`required` 集合 ↔ 实际产出属性集合、`const` ↔ `SCHEMA_VERSION`）；改任一文件必须同步另一个，并且 `schemaVersion` 不兼容变更要按 fail-closed 处理（不得让旧版本被静默降级接受）。
