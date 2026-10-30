
# Grill-Me（需求澄清）

> 内部 playbook：**loaded by designer**，只作为 Designer Phase 1 — Understand 的交互式澄清方法；不属于 executor / prompt-repair / review-with-docs 的通用入口。不是顶层 Skill，也不参与生命周期选择。

> 定位：开发前把“模糊诉求”grill 成“可验收需求”。本 playbook 本身不写 production 代码；澄清完成后返回当前 Designer pipeline，继续 Ambition / Depth / Range / Design / Outside Judge / Execution Plan / Internal Design Grill。

## 启动信号

- 需求是一句话/一段话，边界模糊；
- 关键词有歧义（例：“复盘”指教练报告、数据回放还是功能入口）；
- 用户给的是痛点或方向，不是明确需求；
- 用户自己说“我也没想清楚 / 你先帮我分析下”。

## 流程

1. **先复述理解**：用 1-3 句说出我理解的“要做什么、给谁用、为什么现在做”，让用户低成本纠正。
2. **逐层提问（每轮 ≤ 3 个问题，按重要度排序）**：
   - 语义层：X 具体指什么？包含什么、不包含什么？（挖出非目标）
   - 价值层：成功长什么样？怎么验收？（挖出验收标准）
   - 约束层：数据从哪来？平台/性能/成本/语言？是否必须兼容旧行为？
   - 风险层：最不确定的假设是什么？哪条假设错了需求就变？
3. **给默认答案**：每个问题附“默认我会……，对吗？”，让用户选“对 / 改”而不是从零答。
4. **能从已读事实确认的不问**：项目既有约定、当前 repository evidence 与当前任务已有 plan 信息直接使用，不让用户重复回答。
5. **形成需求确认内容**，作为 `docs/current-plan.md` 后续计划的业务目标/范围/验收标准基础，逐项写清：
   - 目标（一句话）
   - 范围 / 非目标
   - 验收标准（可测、可演示）
   - 关键假设
   - 待确认项（区分“阻塞性”与“可默认”）
6. **返回 Designer**：澄清完成后继续当前 Designer pipeline；不得因“需求已明确”跳过 Ambition、Depth、Range、Outside Judge 或 Internal Design Grill。

## 规则

- 每轮最多 3 个问题；问题越具体越好，禁止开放式问题轰炸。
- 只有按 Designer「授权、计划输入与偏差边界」需要用户决策的问题才停下等答复；非阻塞的用默认假设推进并标注“默认”。完成澄清后继续 Designer，不把阶段报告当作任务结束。
- 不评价需求好坏，只澄清边界与可验收性。
- 澄清结果必须进入当前任务的 `docs/current-plan.md`，不新建第二份需求/计划 SSOT。
