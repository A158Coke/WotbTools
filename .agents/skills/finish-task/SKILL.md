---
name: finish-task
description: >
  PR 合并后的收尾清理——切回 main 并更新、清理 current-plan.md 就绪下一个任务、
  删除已合并 PR 的本地/远端分支。Trigger 为用户说"PR 已合并/开始清理/收尾"，
  或任何以 PR 合并方式完成的任务需要清理工作区、计划文件与分支时。
---

# finish-task

> 全程主代理执行，不 spawn 子代理。

## 前置

- 确认目标 PR 已合并：`gh pr view <n> --json state -q .state` 为 `MERGED`，或用户明确告知已合并。
- 工作区若有未提交改动，先停下向用户确认，不得覆盖或带入清理。

## 流程

1. **切到 main 并更新**
   - `git checkout main`
   - `git pull --ff-only origin main`
   - `git log --oneline -3` 确认本地 main 已包含合并提交。

2. **清理 `docs/current-plan.md`，就绪下一个任务**
   - 读取该文件（gitignore，本地不入库）。
   - 若含进行中任务：按实际结果标记 `COMPLETED` / `BLOCKED`，然后清回初始状态（仅保留头注释）。
   - 初始状态模板：
     ```markdown
     # Current Development Plan

     > 本地开发计划载体（gitignore，不入库）。由 `grill-me` / `grill-with-docs` 写入，`review-with-docs` 同步；任务完成后清理回初始状态。
     ```
   - 无任务条目时保持现状即可。

3. **清理已合并 PR 的分支**
   - 本地：先 `git branch --merged main` 核对，已合并分支用 `git branch -d <branch>` 删除（`-d` 会拒绝未合并分支）。
   - 远端：`git ls-remote --heads origin <branch>` 检查；若仍存在且 PR 已合并，`git push origin --delete <branch>`。
   - 本地/远端分支名不一致时按用户指定处理；不确定时先列出现状再操作。

4. **清理临时文件**：删除本任务产生的临时文件（如 PR 描述临时 md）。

5. **确认并汇报**
   - `git status --short` 干净；`git branch` 只剩 main（或预期分支）。
   - 输出清理清单：合并的 PR / merge commit、删除的分支（本地+远端）、current-plan 状态。

## 安全边界

- 仅在目标 PR 已合并（或用户明确确认）时删除分支。
- 优先 `git branch -d`，禁用 `-D` 兜底；远端删除前必须 `git ls-remote` 确认存在且属于已合并 PR。
- 不清理含未提交改动的工作区；绝不删除 `main`。
