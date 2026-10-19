---
name: designer
description: >
  开发生命周期的第一阶段：把模糊需求澄清成可验收需求，再把已明确需求设计成可执行、
  可验证的分步方案，写入 docs/current-plan.md 并等待用户批准。
  Trigger: 用户提出模糊需求、明确需求但尚无方案、要求“先设计/先 grill 方案再开发”，
  或计划文件需要创建/更新时。它不实现代码，不做 review，不判定 final pass。
---

# Designer（需求澄清 + 方案设计）

> 生命周期位置：模糊需求 / 明确需求 → **Designer** → approved `docs/current-plan.md` → Executor。
> 唯一下一阶段是 Executor；本 Skill 不 review、不实现、不开 PR。

## 输入

- 用户需求（可以模糊）。
- 现有 `docs/current-plan.md`（存在时先完整读取）。
- 相关 canonical 文档与真实代码（只用于核对可落地性，不凭印象）。

## Phase 1 — 需求澄清（按需加载 `.agents/playbooks/requirement-clarification.md`）

当目标、范围、非目标、验收标准或关键约束不清晰时：

1. 复述当前理解，列出已确认事实与未知项。
2. 逐层提问，每轮 ≤3 个，按重要度排序，附默认答案；能从仓库事实推断的不问。
3. 输出《需求确认单》：目标 / 范围 / 非目标 / 验收标准 / 假设与待确认项。
4. 写入 `docs/current-plan.md`；阻塞性分歧未解决前不进入方案设计。

需求已明确（用户给出目标/范围/非目标/验收标准，或 current-plan 已有确认单）时，注明“需求已明确，跳过 grill”，直接进入 Phase 2。

## Phase 2 — 方案设计

1. **可落地性核对**：需求与现有架构/约定是否冲突？用 `rg` / `rg --files` 找现有实现与引用；必须引用具体 `文件:路径` 与 `文档:章节`。
2. **影响面扫描**：按相关内部 playbook 逐层过（跨层改动加载 `.agents/playbooks/wotb-sync.md`；列变更加载 `column-sync.md`；前端 ownership 加载 `frontend-architecture.md`；Keycloak 加载 `keycloak-upgrade/`；服务器生命周期加载 `komodo-server-lifecycle.md`）。
3. **方案设计**：分步实现，每步可独立验证；明确**不做清单**（防过度设计）；给出验收标准与测试路径。
4. **HTTP Contract planning**：涉及 API/跨层 shape 时，方案必须包含 `Contract Impact`、authoritative source、兼容性边界、生成产物、contract validation 与 migration 顺序；明确 domain、transport、view model 的 owner，禁止以兼容为由让前端掩盖后端 producer violation。
5. **风险与默认决策**：列出不确定点；能从文档/代码推断的直接决策并注明依据；影响用户可见行为/成本/破坏兼容的关键决策列给用户确认。
6. **输出《开发方案单》** 到 `docs/current-plan.md`：目标 / 方案概要 / 分步计划（文件清单 + 改动要点 + 验证方式）/ 影响面清单 / 不做清单 / 验收标准 / 待确认项。
7. **等待批准**：方案单写入计划文件后，等用户明确批准才进入 Executor；未批准不得编码。

## 与其他 Skill 的边界

- **不 review**：不执行 final quality gate，不判定 blocker，不代替 `review-with-docs`。
- **不实现**：不写 production 代码、不 commit、不 push、不开 PR。
- **不自行判定 pass**：方案获批只表示可以执行，不表示实现或 review 通过。
- **交接**：approved current-plan → `executor`；实现完成后由 `review-with-docs` 做唯一 final gate。

## 规则

- 只用证据说话：引用 `文档:章节` 与 `文件:路径`；无法从事实源确认的写「待确认」，不猜。
- 不写实现代码；方案获批后才开发。
- 需求/方案变更时更新 current-plan，不另建第二份计划。
- 新增 production abstraction 前先做 Reuse Audit：优先 reuse / extend 现有结构。
