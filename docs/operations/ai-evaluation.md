# Team AI review evaluation

## 默认 CI / 本地测试

默认测试只运行 deterministic contract、validator、synthetic prompt harness 和真实回放 offline harness，不访问任何外部模型，也不需要 `AI_API_KEY`：

```powershell
mvn -pl wotb-web -am test "-Dtest=TeamQualityContractTest,TeamReplayOfflineEvalHarnessTest,LiveAiTestIsolationTest"
```

`AiEvalHarnessTest` 的 synthetic PASS 只代表提示词和规则契约通过；真实回放质量由 offline harness 的证据可用性 gate 与手动 benchmark 分开衡量。

每个 `gold.yaml` 的 `must_notice` / `must_not` 是不含标准答案全文的 case 约束，`evidence_required` 是 offline harness 要求 production grounding facts 提供的中性事实类型。手动报告会记录 notice hit/miss 与 must-not violation；这是 deterministic lexical preflight，不是第二个语义模型裁判。

## 手动 real-replay benchmark

这是显式 opt-in 的 `ai-live` 工具，不是 PR merge gate。必须同时提供开关、case/all 选择和带外 API key；默认只跑一次：

```powershell
$env:AI_API_KEY = "<provided-out-of-band>"
mvn -pl wotb-web -am test `
  "-Dtest=TeamReplayQualityBenchmarkRunnerTest" `
  "-Dai.quality.enabled=true" `
  "-Dai.quality.case=A-flank-local-propagation" `
  "-Dai.quality.runs=1" `
  "-Dai.probe.excludedGroups="
```

多 case 使用逗号分隔；全量必须显式 `-Dai.quality.all=true`。报告写入 `target/ai-eval-report/team-replay-quality-report.json` 和 `.md`，不包含 raw prompt 或 credentials。没有显式 case/all 时不得创建 provider gateway；普通 `mvn test` 即使环境存在 key 也不会运行 benchmark。
