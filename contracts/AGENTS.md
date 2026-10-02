# contracts/ — HTTP wire contract instructions

仓库级规则见 [`../.agents/AGENTS.md`](../.agents/AGENTS.md)。

- `http/openapi.yaml` 是 FE ↔ BE HTTP wire contract 的唯一事实源；修改后必须在 `frontend/` 运行 `npm run api:generate`。
- 这里描述序列化后的 HTTP shape，不承载 `wotb-core` domain 语义。服务器没有回放解析器：不存在 Control ↔ Worker / MQ 契约。
- 新字段必须明确 `required`、nullable、enum、`$ref` 与兼容策略；不得把 internal exception 名称机械暴露为公共 error code。
- `frontend/src/api/generated/` 是生成产物，不手工编辑；fixture 必须使用生产形状且不得包含凭据、token 或用户回放内容。
- 修改 wire contract 时运行 `npm run api:lint`, `npm run api:check`, `npm run api:fixture` 及受影响的后端/前端测试。
- `BattlePlaybackDataset` 等 playback schema 保留在 `components.schemas` 中，但已没有对应的 HTTP path：前端用它校验浏览器本地构建的 2D 数据集（`frontend/src/api/contract-runtime.ts`、`npm run api:fixture` 校验 `http/fixtures/battle-playback-v2.json`）。删 path 不等于可以删这些 schema。
- `agent/` 是上游 WoT-Blitz-Agent（fanypcd/WoT-Blitz-Agent，MIT）回放数据能力的生产方行为契约（`replay-facets-v2.md`）。契约 v2（上游 tag `v0.1.7`，breaking）：独立能力模型——`parseResult` / `parsePlayback` / `parseShotReplays` 三个 WASM 入口；giant envelope `{playback,ai,hof}` 与 `HofFacet` 已从上游拆除，**HoF 是 WotBTools 产品域**（消费方从 BattleResult 投影，见 `frontend/src/api/agent-replay-facets.ts` 的 `projectHoF`）；AI 事件数据保持 Agent 服务端/CLI 能力（DTO 冻结 v1）。样例（`samples/result.sample.json` 与 `samples/ai-review.sample.json`，同场）已从真实匿名回放重导出并核验空值/联表不变量。它不是协议证据主张，也不受 HTTP 契约的生成流程约束；协议语义权威仍在 `docs/research/replay/`。消费方忽略未知键；切面同版本只加字段，不兼容变更递增切面 `version`。WotBTools Playback 拓扑为 client-only：本地 WASM 解析 + `?assets=` 资产平面（`frontend/src/scene/assetProvider.js`），无服务端回退。
