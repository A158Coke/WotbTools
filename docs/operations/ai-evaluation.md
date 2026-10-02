# Team AI review evaluation

## 默认 CI / 本地测试

默认测试只运行 deterministic contract、synthetic prompt harness 和真实回放 offline harness，不访问任何外部模型，也不需要 `AI_API_KEY`：

```powershell
mvn -pl wotb-ai -am test "-Dtest=AiEvalHarnessTest,TeamReplayOfflineEvalHarnessTest,LiveAiTestIsolationTest"
```

`AiEvalHarnessTest` 的 synthetic PASS 只代表提示词和规则契约通过；真实回放质量由 offline harness 的证据可用性 gate 与手动 benchmark 分开衡量。

offline harness 的输入是**冻结的客户端投影夹具**（`common/fixtures/replay-facts/*.json.gz`，`wotb-ai` 的 `ReplayFactsFixtures`）→ canonical timeline → team context → prompt → `TeamGroundingFacts`；服务器没有 parser，评估链不再经过任何服务端解析/重建。

每个 `gold.yaml` 的 `must_notice` / `must_not` 是不含标准答案全文的 case 约束，`evidence_required` 是 offline harness 要求 production grounding facts 提供的中性事实类型。手动报告会记录 notice hit/miss 与 must-not violation；这是 deterministic lexical preflight，不是第二个语义模型裁判。

## 手动 real-replay benchmark

这是显式 opt-in 的 `ai-live` 工具，不是 PR merge gate。必须同时提供开关、case/all 选择和带外 API key；默认只跑一次：

```powershell
$env:AI_API_KEY = "<provided-out-of-band>"
mvn -pl wotb-ai -am test `
  "-Dtest=TeamReplayQualityBenchmarkRunnerTest" `
  "-Dai.quality.enabled=true" `
  "-Dai.quality.case=A-flank-local-propagation" `
  "-Dai.quality.runs=1" `
  "-Dai.probe.excludedGroups="
```

多 case 使用逗号分隔；全量必须显式 `-Dai.quality.all=true`。报告写入 `target/ai-eval-report/team-replay-quality-report.json` 和 `.md`，不包含 raw prompt 或 credentials。没有显式 case/all 时不得创建 provider gateway；普通 `mvn test` 即使环境存在 key 也不会运行 benchmark。

## 2026-10 legacy 契约收敛后的能力变化（已迁移）

两个 `@Tag("ai-live")` 工具已从 legacy envelope / claims validator 迁移到 v0.5
`TeamAiReviewResult` + `TeamAiReviewResultParser`（`TeamQualityShortcutValidator` 与 legacy envelope 均已删除）。

### `TeamReplayQualityBenchmarkRunner`（`TeamReplayQualityBenchmarkRunnerTest`）

- **丢失的 3 个维度**（其唯一生产者已随本次收敛删除）：
  - `grounding`：`TeamFactualConsistencyValidator` 的 HARD_FACT 冲突判定；
  - `structural`：test-only `TeamQualityShortcutValidator` 的违规判定（settlement-only / 车种套角色 /
    未观测信息 / 自动推进 / 无结构性原因的死亡聚集）；
  - `evidenceBasis`：legacy envelope 的 `primaryDiagnosis.evidenceBasis`（envelope-only 字段）。
- **保留的维度**：
  - `contract`：parser 是否可用 + 是否发生确定性 salvage（`parsed.normalized() ? 1 : 2`；0 = 完全不可用）；
  - gold `must_notice` / `must_not` 预检（report-only lexical preflight，只是提示，不是语义裁判）；
  - 9 个 lexical 维度：`informationReasoning` / `objectiveReasoning` / `localEngagement` /
    `crossLocalPropagation` / `positionTempo` / `settlementDiscipline` / `causalDepth` /
    `coachingUsefulness` / `naturalChinese`。
- **报告列**：`shortcuts` 列已删除，改名为 `contract`（Markdown 表头为 `| case | run | contract | overall |`）。
  恒为 `null` 的 `semantic` 占位维度（从不计算、只写进 JSON 报告，造成「存在语义裁判维度」的误导）已一并删除——
  JSON 报告的 `dimensionScores` 现在只含 `contract` 与上述 9 个 lexical 维度。
- **语义变化**：`contract` 不再等价于「事实无冲突」。旧的 `grounding` / `structural` 通过意味着
  「模型没有改写 backend 事实」；`contract` 通过只意味着「能解析出满足最低 contract 的 v0.5 结构」。
  不要再用迁移后的分数宣称事实一致性。

### `TeamTacticalSkillLiveBehaviorEvalTest`

- 现存每例 check 共 5 项：`primaryDiagnosis present`、`natural team review text present`、
  `no communication/call attribution`、`no authoritative tactical label`、`case behavior`（A–H）。
- **不再有**的两项 check：`grounding validator`（legacy envelope + 事实一致性 validator）与
  `## 团队复盘` heading（自然复盘标题的 Markdown 结构检查）。

> **未验证项（必须显式确认）**：上述两个 `@Tag("ai-live")` 测试本次**只做了编译验证**——
> 默认 `mvn test` 因 tag/开关排除不会执行它们，本次收敛的验证命令
> （`-Dtest=ObservabilityDashboardContractTest`）也不覆盖它们。它们的**运行时等价性尚未验证**，
> 需要各自显式 live 运行一次（`-Dai.quality.enabled=true` + case/all 或
> `-Dai.tactical.live.enabled=true`，并清空 `-Dai.probe.excludedGroups=`，配带外 `AI_API_KEY`）
> 才能确认迁移后的检查项、评分维度与报告内容符合预期。在此之前不要把迁移后的分数与旧报告直接对比。
