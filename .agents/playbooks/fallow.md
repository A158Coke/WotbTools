# fallow

> 内部 playbook：**loaded by review-with-docs**；只用于 final review 的前端诊断，不参与 lifecycle routing。不是顶层 Skill。

## 前置条件

已在 `frontend/` 安装 `fallow`（3.14.0）。配置在 `frontend/.fallowrc.json`；browser gate 以 vite 模块 URL 或 fixture-server 别名加载的脚本已列为 entry，不应再被报为未使用文件。

## 用法

以下命令均在 `frontend/` 下运行。发现问题时退出码为 1，这是正常的诊断结果，不是命令错误。

```bash
cd frontend

# 一次跑完 dead-code + dupes + health
pnpm exec fallow

# 未使用的文件 / 导出 / 类型 / 依赖，以及循环依赖
pnpm exec fallow dead-code

# 只看循环依赖
pnpm exec fallow dead-code --circular-deps

# 重复代码
pnpm exec fallow dupes

# 函数复杂度（cyclomatic + cognitive）
pnpm exec fallow health --complexity

# 只看本分支相对 main 的变更引入了什么（review 用）
pnpm exec fallow audit --base origin/main --gate new-only
```

已知限制：本仓库的 Windows 本机上，`audit --gate new-only` 会因为创建 base 快照用的临时 worktree 失败而退出 2（`could not create a temporary worktree for base ref`），关掉沙箱、换 `TMP` 都没用。这时改用 `--gate all`（不建 base 快照，但会连同变更文件里的存量 finding 一起报），或者到 Linux 上跑。

追查单条 finding：`pnpm exec fallow dead-code --trace <file>:<export>`。

## 集成到 Review With Docs

前端代码变更后，`review-with-docs` final gate 内可选执行：

```bash
cd frontend && pnpm exec fallow audit --base <main-ref> --gate new-only
```

把新引入（`introduced: true`）的 dead-code、复杂度和重复代码 finding 纳入审查报告，按 code-quality 规则人工判定；继承的存量 finding 不算本次改动的问题。它只是提示，不是 CI gate，原因见下节。

## 为什么不进 CI

2026-11-11 用 fallow 3.14.0 回放了 `main` 上最近 10 个改动 `frontend/` 的已合并 PR（#955、#950、#952、#949、#953、#951、#948、#946、#947、#941）。对每个 PR 的 merge-base 和 head 各跑一次 `fallow health --complexity`，变更文件里 base 没有的函数 finding 记为“新增”，等价于 `audit --gate new-only` 的复杂度判定（本机 Windows 上 `audit` 自建 base 临时 worktree 失败，所以用这种方式模拟）：

- 10 个 PR 里有 4 个会被拦，共 9 条新增 finding。
- 8 条在 `frontend/scripts/browser-*.mjs`（浏览器门禁脚本里的场景函数），不是生产代码。
- 唯一的生产 finding 是 `usePlaybackFullscreen.ts` 里的 `enterFullscreen`（14 行，cyclomatic 12 / cognitive 9，都低于 20 / 15 的阈值），只因为基于估算覆盖率的 CRAP 43 超过 30 才被报出，算误报。
- 真正值得拦的新增复杂函数：0 条。

误报率太高，又没有命中真问题，所以只作为 review 阶段的提示，不进 `ci-frontend.yml`。以后再评估时，先把 `scripts/**` 排除，再用真实覆盖率（`--coverage`）重算 CRAP，然后重新回放。

## 配置文件

`frontend/.fallowrc.json`（JSONC）。修改 entry 时，确认 `pnpm exec fallow dead-code` 的 unused files 没有误报。
