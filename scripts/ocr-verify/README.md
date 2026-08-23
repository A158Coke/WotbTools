# OCR Integration Verification (Cases 1–6)

本目录验证 review-with-docs 的 OpenCodeReview 集成（docs/current-plan.md §十六）。

## 确定性检查（脚本）

```bash
pwsh -File scripts/ocr-verify/verify-ocr.ps1
```

覆盖：

- **Case 5** — 多 commit 分支：`ocr delegate preview --from main --to feature` 基于
  merge-base 覆盖全部 commit 的变更（不是 HEAD~1）。
- **Case 1（确定性部分）** — 规则解析：`ocr delegate rule` 对含 NPE bug 的 fixture
  命中项目规则（`.opencodereview/rule.json`）。
- **Case 6** — 无有效 diff：`reviewable_count == 0` → 友好 no-diff 路径。
- **Case 4** — OCR 失败：非法 flag / 非法 repo → 非零退出码，绝不当作 no findings。

## 主代理驱动（agent-driven，README 记录执行过程）

### Case 1 — 正常代码 bug（fixtures/buggy/SampleService.java）

fixture 含明确 NPE：`Integer stored = scores.get(player); return stored + 1;`
（absent player → unboxing NPE）。

预期：OCR 规则命中 → 主代理审查 diff → 发现 NPE → Layer C 验证后定级 BLOCKER。

### Case 2 — Requirement 完全遗漏（fixtures/plan-fixture.md）

plan 要求 Feature X（DetailPanel 显示坦克图）与 Feature Y（SampleService 对无记录
玩家不抛异常）。diff 未实现 Feature X。

预期：OCR 无 finding 也不影响 —— Layer A Plan Auditor 报告 `MISSING / BLOCKER`。

### Case 3 — OCR false positive

OCR 可能建议（如「改为 Optional 返回 / 提取接口」）但 fixture 架构简单、requirement 未要求。

预期：Reconciler 拒绝或降级，不无脑升 blocker（§四 示例 3）。

### Case 4 — OCR failure（延续脚本）

预期：不伪造 success；Layer A plan audit 继续；输出 review incomplete / blocker。

## 相关文件

- `fixtures/base/SampleService.java` — Case 5 base commit（正确版本）
- `fixtures/buggy/SampleService.java` — Case 1 buggy fixture
- `fixtures/plan-fixture.md` — Case 2 plan 夹具
- `verify-ocr.ps1` — 确定性检查脚本
