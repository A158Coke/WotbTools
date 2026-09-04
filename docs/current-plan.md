# Team AI Tactical Review v0.1

## 状态

IMPLEMENTED IN WORKTREE — READY FOR REVIEW

## 范围

- 保留现有 Canonical BattleTimeline → deterministic evidence → Team Call #2 → grounding validator 架构。
- 通过 `AiPromptLibrary` include 注入 team-execution、position-tempo、hp-trades、mode-objectives 四个紧凑模块。
- 修正 `primaryDiagnosis`：表示本场最重要结论，不强制制造错误；保留 JSON 字段避免无关契约变更。
- 明确 Strategic Prior 只是战略基线/可能性空间，不是实际队伍计划；禁止推断语音、call、通信或指挥责任。
- 复用现有中性 timeline/evidence（进入时序、空间分离、局部人数、信息更新、点数与交火），不建立第二套 episode 或后端战术 verdict。
- 增加三语 prompt contract、golden cases、validator/no-fault 回归，并同步 AI 架构与 Team Review 文档。

## 验收标准

1. Team prompt 含四个模块，EN/RU 本地化不残留中文模块规则。
2. Prompt 明确 evidence-insufficient → skip、operation vs decision、position > kill、HP/gun value、commitment/half-commit、rotation/tempo 及模式目标经验规则。
3. Prompt 不把最新到达者自动定责，不把 Strategic Prior 当实际计划，不推断 communication/call。
4. `primaryDiagnosis` 可自然表达无明显确认错误/关键成功因素/对手处理更好；validator 仍要求结构完整与 grounding。
5. Golden cases A–H 注册并通过 deterministic prompt harness；相关单测通过。
6. 文档与实现一致；不新增 backend tactical verdict。

## 实施与验证记录

- [x] 从 `main` 建立独立 worktree `feature/team-ai-tactical-review-v01`。
- [x] 添加四个模块化 ZH prompt 资源与 EN/RU localization anchors。
- [x] 更新 Team prompt、主诊断/Strategic Prior 契约与核心 envelope 文档。
- [x] 更新 docs/architecture/ai-review.md 与 docs/features/team-ai-review.md。
- [x] 添加/更新 deterministic tests 与 golden cases。
- [x] 运行 targeted Maven tests（Web 15/15、Core validator 80/80）。
- [x] 完成 review-fix / code-smell / review-with-docs 自审闭环；OCR workspace preview 识别 11 个 reviewable 文件，未发现 blocker。

## 结果边界

- 本 worktree 未执行 DeepSeek live provider evaluation；该项需要用户显式提供实际训练/联赛回放并 opt-in，以避免普通开发测试产生 provider 成本。
