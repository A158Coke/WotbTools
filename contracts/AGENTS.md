# contracts/ — HTTP wire contract instructions

仓库级规则见 [`../.agents/AGENTS.md`](../.agents/AGENTS.md)。

- `http/openapi.yaml` 是 FE ↔ BE HTTP wire contract 的唯一事实源；修改后必须在 `frontend/` 运行 `npm run api:generate`。
- 这里描述序列化后的 HTTP shape，不承载 `wotb-core` domain 语义，也不替代 `java/wotb-contracts` 的 Control ↔ Worker contract。
- 新字段必须明确 `required`、nullable、enum、`$ref` 与兼容策略；不得把 internal exception 名称机械暴露为公共 error code。
- `frontend/src/api/generated/` 是生成产物，不手工编辑；fixture 必须使用生产形状且不得包含凭据、token 或用户回放内容。
- 修改 wire contract 时运行 `npm run api:lint`, `npm run api:check`, `npm run api:fixture` 及受影响的后端/前端测试。
- `mq/parser-messages.json` 是 RabbitMQ parser 协议的 JSON Schema（`parser.request` / `parser.result` / `parser.failed`），不是 HTTP contract。它的应用侧权威是 `java/wotb-broker-rabbitmq` 的 `ParserMessageCodec`，两者由该模块的 `ParserMessageContractTest` 互锁（`required` 集合 ↔ 实际产出属性集合、`const` ↔ `SCHEMA_VERSION`）；改任一文件必须同步另一个，并且 `schemaVersion` 不兼容变更要按 fail-closed 处理（不得让旧版本被静默降级接受）。
- `agent/` 是上游 WoT-Blitz-Agent（fanypcd/WoT-Blitz-Agent，MIT）回放 Facet 的消费目标契约（`replay-facets-v1.md`）。上游公开 `main` 尚无 Facet 导出入口；现存 hof 样例仅供形状参考，不得把它或已撤下的 ai-review 样例宣称为当前 producer 可复现输出。Facet 发布后必须从真实匿名回放重导出样例、验证不变量，再转为生产方行为契约。它不是协议证据主张，也不受 HTTP/MQ 契约的生成与互锁流程约束；协议语义权威仍在 `docs/research/replay/`。
