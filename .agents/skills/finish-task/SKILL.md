---
name: finish-task
description: >
  PR 合并后的收尾清理——切回 main 并更新、清理 current-plan.md 就绪下一个任务、
  删除任务 worktree、删除已合并 PR 的本地/远端分支。Trigger 为用户说"PR 已合并/开始清理/收尾"，
  或任何以 PR 合并方式完成的任务需要清理工作区、计划文件与分支时。
---

# finish-task

> 全程主代理执行，不 spawn 子代理。

## 前置

- 确认目标 PR 已合并：`gh pr view <n> --json state -q .state` 为 `MERGED`，或用户明确告知已合并。
- 工作区若有未提交改动，先停下向用户确认，不得覆盖或带入清理。
- 执行 `git worktree list --porcelain` 确认主 worktree 与当前任务 worktree；主 worktree
  是唯一保留目录，除非用户明确要求保留其它 worktree。

## 流程

1. **清理任务 worktree（如当前任务使用了独立 worktree）**
   - 先在任务 worktree 执行 `git status --short`；存在未提交改动时立即停止并向用户确认，
     禁止使用 `--force` 删除或覆盖。
   - 记录任务 worktree 的绝对路径与分支，然后切换命令工作目录到主 worktree；不得在待删除
     worktree 内执行删除自身的操作。
   - 在主 worktree 执行 `git worktree remove <task-worktree-path>`，并执行
     `git worktree prune`；确认 `git worktree list --porcelain` 最终只保留主 worktree。

2. **切到 main 并更新**
   - `git checkout main`
   - `git pull --ff-only origin main`
   - `git log --oneline -3` 确认本地 main 已包含合并提交。

3. **清理 `docs/current-plan.md`，就绪下一个任务**
   - 读取该文件（gitignore，本地不入库）。
   - 若含进行中任务：按实际结果标记 `COMPLETED` / `BLOCKED`，然后清回初始状态（仅保留头注释）。
   - 初始状态模板：
     ```markdown
     # Current Development Plan

     > 本地开发计划载体（gitignore，不入库）。由 `grill-me` / `plan-designer` 写入，`review-with-docs` 同步；任务完成后清理回初始状态。
     ```
   - 无任务条目时保持现状即可。

4. **清理已合并 PR 的分支**
   - 本地：先 `git branch --merged main` 核对，已合并分支用 `git branch -d <branch>` 删除（`-d` 会拒绝未合并分支）。
   - 远端：`git ls-remote --heads origin <branch>` 检查；若仍存在且 PR 已合并，`git push origin --delete <branch>`。
   - 本地/远端分支名不一致时按用户指定处理；不确定时先列出现状再操作。

5. **清理临时文件**：删除本任务产生的临时文件（如 PR 描述临时 md）。

6. **确认并汇报**
   - 主 worktree `git status --short` 干净；`git worktree list --porcelain` 只剩主目录；
     `git branch` 只剩 main（或预期分支）。
   - 输出清理清单：合并的 PR / merge commit、删除的分支（本地+远端）、current-plan 状态。

## 安全边界

- 仅在目标 PR 已合并（或用户明确确认）时删除分支。
- 优先 `git branch -d`，禁用 `-D` 兜底；远端删除前必须 `git ls-remote` 确认存在且属于已合并 PR。
- 不清理含未提交改动的 worktree；绝不删除 `main` worktree、`main` 分支或主目录。
- 删除独立任务 worktree 必须从主 worktree 执行，使用非强制 `git worktree remove`；任何非主
  worktree 存在未提交改动时，先停下请求用户决定，不得强制删除。
