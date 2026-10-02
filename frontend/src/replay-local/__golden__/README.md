# 客户端回放计算的 golden 数据

服务端 Java 解析器 / 批次计算退役前，由 `tools/parity` 在**仓库已提交的 fixture 回放**上生成，
作为客户端移植的逐字段基准，也是 Java 删除后的回归基线。

| 文件 | 来源 |
|---|---|
| `batches.json` | 批次清单（单场 / 联赛多场 / 混合 / 重复 / 损坏文件） |
| `wasm-results.json` | 上游 Rust Core `parseResult`（`deploy/agent/source.json` 锁定版本），按文件名 |
| `java-battles.json` | Java `ReplayParser` 的 `Battle`，按文件名 |
| `java-preview.json` | Java `ReplayBatchFinalizer.finalizeBatch` + `Mapper.toPreviewResponse`，按批次 |
| `java-export.json` | Java 导出（`ExcelExporter`/POI，aggregate + each 两种模式，含战队名称覆盖变体）读回归一化的工作簿，按批次；输入取 `java-battles.json`，时区 Asia/Shanghai |

重新生成见 `tools/parity/README.md`。Java 删除后这些文件只读，不再重新生成。
