# OCR Integration Verification (Cases 1–6)

本目录验证 review-with-docs 的 OpenCodeReview 集成。Case 1–6 分两类：

| 类别 | 覆盖 | 执行方 | 可重复性 |
|---|---|---|---|
| **Deterministic tests** | OCR 管线确定性行为（范围/规则/失败退出码） | `verify-ocr.ps1`（无 LLM） | ✅ 任何环境可重复运行 |
| **Agent-level scenarios** | 需要主代理推理的完整审查闭环 | 主代理按 `review-with-docs` SKILL.md 执行 | ⚠️ 依赖 DSH/DeepSeek，验证时人工驱动并记录结果 |

> **声明边界**：只有 deterministic tests 由脚本自动断言；agent-level scenarios 的
> 结论（BLOCKER 定级、MISSING 判定、false positive 拒绝）由主代理在执行时验证，
> 不在脚本中硬断言——避免把 LLM 推理结果伪装成确定性测试。

## Deterministic tests（`verify-ocr.ps1`）

```bash
pwsh -File scripts/ocr-verify/verify-ocr.ps1
```

脚本在临时 git repo（含正确基线 + 多 commit 分支）中断言：

- **Case 5 — 多 commit 分支**：`ocr delegate preview --from main --to feature` 基于
  merge-base 覆盖全部 commit 的变更（不是 HEAD~1）——断言 reviewable_files 含
  SampleService.java 与 Util.java。
- **Case 1（确定性部分）— 规则解析**：`ocr delegate rule` 对含 NPE bug 的 fixture
  命中**项目规则**（`source=project`，`.opencodereview/rule.json`）——断言规则来源与
  文件归属；**不**断言 NPE 是否被检出（那属于 agent-level Case 1 完整闭环）。
- **Case 6 — 无有效 diff**：`reviewable_count == 0` → 友好 no-diff 路径——断言
  reviewable_count=0；**不**断言 plan audit 继续（agent-level）。
- **Case 4（确定性部分）— OCR 失败退出码**：非法 flag / 非法 repo → 非零退出码，
  证明 OCR 失败**可以**被识别；**不**断言「plan audit 继续 / review incomplete 标记」
  （agent-level，见下）。

## Agent-level scenarios（主代理按 skill 执行，验证时驱动并记录）

> 这些场景需要 LLM 推理（规则理解、代码审查、定级判断），由主代理在真实 DSH
> 会话中执行 `review-with-docs` 流程验证；本 README 记录预期与验证方式。

### Case 1 — 正常代码 bug 完整闭环（fixtures/buggy/SampleService.java）

fixture 含明确 NPE：`Integer stored = scores.get(player); return stored + 1;`
（absent player → unboxing NPE）。

预期：确定性部分（规则命中）由脚本断言；完整闭环由主代理执行——OCR 规则命中 →
主代理审查 diff → 发现 NPE → Layer C 验证后定级 BLOCKER。

### Case 2 — Requirement 完全遗漏（fixtures/plan-fixture.md）

plan 要求 Feature X（DetailPanel 显示坦克图）与 Feature Y（SampleService 对无记录
玩家不抛异常）。diff 未实现 Feature X。

预期：OCR 无 finding 也不影响 —— Layer A Plan Auditor 报告 `MISSING / BLOCKER`。

### Case 3 — OCR false positive

OCR 可能建议（如「改为 Optional 返回 / 提取接口」）但 fixture 架构简单、requirement 未要求。

预期：Reconciler 拒绝或降级，不无脑升 blocker（§四 示例 3）。

### Case 4 — OCR failure 的 review 级处理（延续确定性部分）

确定性部分（非零退出码）由脚本断言；review 级处理由主代理验证：不伪造 success、
Layer A plan audit 继续、输出 review incomplete / blocker。

## 相关文件

- `fixtures/base/SampleService.java` — Case 5 base commit（正确版本）
- `fixtures/buggy/SampleService.java` — Case 1 buggy fixture
- `fixtures/plan-fixture.md` — Case 2 plan 夹具
- `verify-ocr.ps1` — deterministic tests 脚本