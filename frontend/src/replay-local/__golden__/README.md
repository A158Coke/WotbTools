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
| `wasm-playback.json` | 上游 `parsePlayback`（0.5 s 抽样）+ `parseResult` + `parseAiReview` 伤害事件，按文件名 |

Java 已删除：`java-*` 文件只读、不再重新生成。上游 Rust Core 升级后，`wasm-*` 用新产物重新导出，再跑同一组测试确认仍与 Java 基线一致。
