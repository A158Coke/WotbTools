# AI Product QA Workflow

`AI / Product QA` 是生产站黑盒探索测试：让 OpenAI computer-use 模型通过真实 Chromium 操作 `https://wotbtools.com`。

它刻意独立于 PR CI：不读取仓库代码，也不替代 Vitest / Playwright 等确定性回归测试。

## 触发方式

- 定时：每周一 `03:17 UTC`。
- 手动：Actions → `AI / Product QA` → Run workflow。

手动参数：

- `scenario`
  - `desktop-exploratory`：1440×900，广覆盖探索。
  - `mobile-exploratory`：390×844，移动端探索。
  - `smoke`：有界核心流程 smoke。
- `model`：默认 `gpt-6-astra`，也可选 `gpt-6.1-sol`。
- `create_issues`：默认 `false`；开启后只有 `bug + high confidence + reproduction >= 2` 才允许自动建 Issue。

**定时任务永远不自动创建 Issue**，只产出报告与证据，避免随机探索造成 Issue spam。

## 必需 Secret

仓库 Settings → Secrets and variables → Actions → Repository secrets 添加：

```text
OPENAI_API_KEY
```

runner 启动后会把 `OPENAI_API_KEY` / `GITHUB_TOKEN` 保存到外层进程变量，并立即从 `process.env` 删除；模型本身没有 shell、代码执行、文件系统或 GitHub 工具。

## 安全边界

模型只获得 Responses API 的 `computer` 工具和结构化 `report_finding` 函数。

运行时约束：

- 顶层页面只允许 `https://wotbtools.com` 及其子域；
- v1 不登录、不进入外部 QQ / WG IdP；
- 下载自动取消；
- dialog 自动 dismiss；
- computer action 上限 140；
- smoke 最多 10 turn，其余最多 20 turn；
- job 超时 45 分钟；
- 每个 computer turn 自动保存截图；
- prompt 明确禁止购买、破坏性写操作、外部登录和个人数据传输。

Replay 文件选择器允许测试：runner 自动注入仓库 canonical fixtures：

- `common/fixtures/replays/random-battle-example.wotbreplay`
- `common/fixtures/replays/cw-training-15-14-example.wotbreplay`
- `common/fixtures/replays/tournament-14-14-example.wotbreplay`

单文件 picker 使用 random battle fixture；multi-file picker 使用三份 fixture。

## 证据产物

每次 run 上传 `artifacts/ai-qa/`，保留 14 天：

- `report.md`：模型总结 + 标准化 finding；
- `findings.json`：机器可读 finding；
- `journal.log`：runner 的安全/运行事件；
- `screenshots/*.jpg`：浏览器证据；
- `failure.txt`：仅 runner 失败时产生。

同一份报告写入 GitHub Actions Job Summary。

手动 `create_issues=true` 时，workflow 会创建/复用 `ai-qa` label，并用标题派生稳定 marker 对**当前 open AI QA issues**做去重。

## Finding 门槛

模型必须至少复现 2 次才允许调用 `report_finding`。runner 还会再次拒绝 `reproduction_count < 2`。

自动 Issue 进一步要求：

- `category == bug`
- `confidence == high`
- `reproduction_count >= 2`

UX / visual / confusing / investigate 默认只留在报告，不自动建 Issue。

## 运维原则

这些 finding 是**黑盒 QA 证据**，不是 root-cause 结论。后续仍走正常仓库流程：

1. 人工/Agent 再复现；
2. 进入 repo 定位 root cause；
3. targeted validation；
4. 由 `CI / Required Gate` 作为 repository-level authoritative gate。

不要把这个 workflow 接入 `ci-gate.yml`，也不要设成 required PR check。它昂贵、随机，而且验证的是生产行为，不是 PR 的确定性正确性。

## 后续：Authenticated QA

v1 只做匿名/public black-box QA。

如果以后加入登录测试，应使用独立、低权限测试账号，并在模型上下文之外注入已认证 browser storage state；在启用截图前重新审查 artifact 隐私。不要把 QQ / WG 实际账号密码交给模型。
