---
name: finish-task
description: >
  PR 合并后的收尾薄入口。用户说 finish-task / PR 已合并，收尾 / 清理当前已合并任务时，
  委托 executor 的 post-merge cleanup fast path；不用于实现、审查或合并 PR。
---

# Finish Task（收尾入口）

本入口让 harness 能发现并调用 `$finish-task`；收尾仍由 Executor 拥有，不新增 lifecycle 阶段。

读取 [Executor Skill](../executor/SKILL.md)，携带当前用户指定或上下文已明确的 PR / 任务信息，直接进入其流程 0 — Post-merge cleanup fast path。
该路径负责验证 merge 事实并加载 canonical cleanup playbook，不要求重新创建执行计划或进入 implementation phases。

收尾步骤、所有权、授权及安全边界全部以 Executor 和它加载的 playbook 为准；本入口不维护第二份规则。
