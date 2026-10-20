# Post-merge Cleanup（内部 playbook）

> 内部 playbook：**loaded by executor**；仅用于 merge 后 cleanup，不参与其他生命周期阶段。不是顶层 Skill，也不参与生命周期选择。

> 全程主代理执行，不 spawn 子代理。

## 输入与所有权

- cleanup 只拥有**当前已合并任务**的 worktree、任务分支与该任务产生的临时文件。
- 其他任务的 worktree / branch 无条件 preserve；无论是否 clean，都不得因为本次 cleanup 删除、prune 对应目录或要求仓库最终只剩 main。
- Executor 已有 `<remote>` handoff 时必须复用该值。fresh-context cleanup 没有 handoff 时，先读取目标 PR 的 base repository / base ref，并用 `git remote -v` 核验实际承载该 upstream/main 的 remote；执行 `git fetch <remote> main` 后记录 `<main-ref> = <remote>/main`。禁止默认或硬编码 `origin`。

## 前置

- 确认目标 PR 已合并：`gh pr view <n> --json state -q .state` 为 `MERGED`，或用户明确告知已合并。
- 明确当前 merged task 的 branch；若存在独立 worktree，同时明确其绝对路径。无法确认某个 worktree / branch 是否属于当前任务时，视为其他任务并 preserve。
- 当前任务 worktree 若有未提交改动，先停下向用户确认，不得覆盖或强制删除。
- 若更新 main 需要使用主 worktree，先检查该主 worktree 的 `git status --short`；存在未提交改动时停止并汇报，不得覆盖。其他 worktree 的状态不属于本次 cleanup 判定范围。
- 执行 `git worktree list --porcelain` 仅用于定位当前任务 worktree 与主 worktree；不得把“非主 worktree”自动解释为本次待删除对象。

## 流程

1. **清理当前任务 worktree（如本任务使用了独立 worktree）**
   - 只对已确认属于当前 merged task 的 worktree 执行 `git status --short`；存在未提交改动时立即停止并向用户确认，禁止使用 `--force` 删除或覆盖。
   - 记录当前任务 worktree 的绝对路径与分支，然后切换命令工作目录到主 worktree；不得在待删除 worktree 内执行删除自身的操作。
   - 在主 worktree 执行 `git worktree remove <task-worktree-path>`，再执行 `git worktree prune`。
   - 复核 `git worktree list --porcelain`：当前任务 worktree 必须消失；其他任务 worktree 必须保持原样。

2. **切到 main 并更新**
   - `git checkout main`
   - `git pull --ff-only <remote> main`
   - 用已知 merge SHA 做 ancestry 校验：`git merge-base --is-ancestor <merge-sha> <main-ref>`（退出码 0 = 本地 main 已包含）；不得只检查最近几条 `git log`，后续已有其他提交时该确认仍必须成立。

3. **清理 `docs/current-plan.md`，就绪下一个任务**
   - 读取该文件（gitignore，本地不入库）。
   - 若含当前已合并任务：按实际结果标记 `COMPLETED` / `BLOCKED`，然后清回初始状态（仅保留头注释）。
   - 不清理属于其他仍在进行任务的计划内容；无法确认归属时停止并汇报。
   - 初始状态模板：
     ```markdown
     # Current Development Plan

     > 本地开发计划载体（gitignore，不入库）。由 `designer` 创建 approved plan，`executor` 更新执行状态，`review-with-docs` 做 final audit；任务完成后清理回初始状态。
     ```
   - 无当前任务条目时保持现状即可。

4. **清理当前已合并 PR 的任务分支**
   - 本地：先 `git branch --merged <main-ref>` 核对；只对当前任务分支使用 `git branch -d <task-branch>` 删除（`-d` 会拒绝未合并分支）。其他任务分支一律 preserve。
   - 远端：`git ls-remote --heads <remote> <task-branch>` 检查；若仍存在且已确认属于目标 merged PR，执行 `git push <remote> --delete <task-branch>`。
   - 本地/远端分支名不一致时按目标 PR 的真实 head ref 与用户指定处理；不确定时先列出现状再操作。

5. **清理当前任务临时文件**：仅删除本任务产生的临时文件（如 PR 描述临时 md）；其他任务或归属不明的文件 preserve。

6. **确认并汇报**
   - 当前任务 worktree 已从 `git worktree list --porcelain` 消失；其他 worktree 保持原样。
   - 当前任务本地分支已删除；若目标 remote 上原本存在该分支，则远端当前任务分支也已删除。不得要求 `git branch` 最终只剩 main。
   - main 已包含目标 merge commit；若检查过主 worktree，其状态未被本次 cleanup 污染。
   - 输出清理清单：合并的 PR / merge commit、当前任务删除的 worktree 与分支（本地+远端）、preserved 的其他 worktree / branch、current-plan 状态、使用的 `<remote>` / `<main-ref>`。

## 安全边界

- 仅在目标 PR 已合并（或用户明确确认）时删除当前任务分支。
- cleanup ownership 只覆盖当前 merged task；其他 worktree / branch 无条件 preserve，不因其 clean、已合并或看似陈旧而顺手清理。
- 优先 `git branch -d`，禁用 `-D` 兜底；远端删除前必须 `git ls-remote` 确认存在且属于目标已合并 PR。
- 禁止硬编码 `origin`；复用 Executor handoff 的 `<remote>`，或在 fresh-context cleanup 中重新核验 upstream/main remote。
- 不清理含未提交改动的当前任务 worktree；绝不删除 `main` worktree、`main` 分支或主目录。
- 删除当前任务独立 worktree 必须从主 worktree 执行，使用非强制 `git worktree remove`；其他任务 worktree 不属于本次 cleanup，不检查后删除、不强制删除。
