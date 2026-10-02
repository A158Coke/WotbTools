# 客户端回放计算的 golden 数据

服务端 Java 解析器 / 批次计算退役前，由迁移期工具 `tools/parity`（已随 Java 解析器删除，见 git 历史）
在**仓库已提交的 fixture 回放**上生成，作为客户端移植的逐字段基准，也是 Java 删除后的回归基线。

| 文件 | 来源 |
|---|---|
| `batches.json` | 批次清单（单场 / 联赛多场 / 混合 / 重复 / 损坏文件） |
| `wasm-results.json` | 上游 Rust Core `parseResult`（`deploy/agent/source.json` 锁定版本），按文件名 |
| `java-battles.json` | Java `ReplayParser` 的 `Battle`，按文件名 |
| `java-preview.json` | Java `ReplayBatchFinalizer.finalizeBatch` + `Mapper.toPreviewResponse`，按批次 |
| `java-export.json` | Java 导出（`ExcelExporter`/POI，aggregate + each 两种模式，含战队名称覆盖变体）读回归一化的工作簿，按批次；输入取 `java-battles.json`，时区 Asia/Shanghai |
| `java-playback.json` | 服务端 2D 回放 body：`battle-playback-v2` + `map-overview`（parser worker 同一路径；浮点舍入、去 `routes`），按文件名 |

时序 golden（2D 回放 `playback/playback.golden.test.ts`、AI 投影 `ai/toClientAiReviewProjection.test.ts`）不再读手工导出的
中间件，而是由 `agentWasmNode.ts` 现场运行 `deploy/agent/source.json` 锁定版本的上游 WASM 解析 fixture 回放（产物版本与
pin 不符即失败）；AI 投影的永久 golden 在 `common/fixtures/ai-projection/`（Java 侧 `ClientAiProjectionParityTest` 读取）。

Java 已删除：`java-*` 文件只读、不再重新生成。上游 pin 升级后：`node scripts/export-wasm-results.mjs` 重新导出
`wasm-results.json`，`WOTB_UPDATE_AI_PROJECTION_GOLDEN=1 npx vitest run src/replay-local/ai/` 重生成 AI 投影 golden，
再跑全部 replay-local 测试与 `ClientAiProjectionParityTest`，确认仍与 Java 基线一致。
