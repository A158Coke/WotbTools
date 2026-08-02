# Add PR #43 follow-up fixes to CHANGELOG [Unreleased] Changed section
path = 'docs/CHANGELOG.md'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()
lines = text.split('\r\n')

unreleased_idx = next(i for i, l in enumerate(lines) if l.strip() == '## [Unreleased]')
changed_idx = next(i for i, l in enumerate(lines) if i > unreleased_idx and l.strip() == '### Changed')

entries = [
    '- **CI 端口检查按服务断言（PR #43 跟进）**：prometheus/loki/alloy/grafana/wotb-backend 不得有任何宿主端口映射（直接断言 ports 为空，防 `18088:8088` target 绕过）；frontend `8088:80` 为合法对外入口不在此列。',
    '- **AI upstream 指标语义修正（PR #43 跟进）**：`checkTokenBudget()` 先于指标统计执行；只有检查通过、准备执行 `restClient.post()` 才 +1 `wotb_ai_upstream_requests_total` 并启动 duration Timer；token budget rejection 不产生 request/error/duration。新增 `AiReplayAnalysisServiceUpstreamMetricsTest`（3 用例）。',
    '- **删除误导性 `wotb_replay_results_total`（PR #43 跟进）**：解析失败以 `ReplayProcessingResult.status=FAILED` 返回而非抛异常，异常判定不可靠，删除该指标及 Replay Parser Dashboard「解析失败率」「成功/失败」面板；保留 requests/files/duration/in-flight。AI Review 自己的 results_total 不受影响。',
    '- **Dashboard 变量修正（PR #43 跟进）**：两个 Dashboard 的 Loki 查询 `requestId=~"${requestId:.*}"` → `${requestId:raw}`（textbox 默认仍 `.*`）；删除未被任何查询使用的 `operation` 变量。',
    '- **文档验证边界诚实化（PR #43 跟进）**：删除 `alloy run --dry-run` 与 `fmt --check`（v1.4.2 实际用 `fmt -t`）；明确 CI 仅验证本地 compose 与配置文件语法/结构，不验证生产 heredoc 渲染、不验证指标名真实存在；完整 Alloy/指标验证标注为生产部署后手动项。',
]

lines[changed_idx:changed_idx] = entries

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write('\r\n'.join(lines))

with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
print('PR #43 跟进 refs:', check.count('PR #43 跟进'))
print('fmt -t:', check.count('fmt -t'))
print('replay_results_total:', check.count('wotb_replay_results_total'))
