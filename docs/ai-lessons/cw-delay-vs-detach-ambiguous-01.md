# AI Lesson：cw-delay-vs-detach-ambiguous-01 — 信号矛盾不硬下标签

- **案例 id**：`cw-delay-vs-detach-ambiguous-01`
- **场景**：M3 单走静止（115–260s）且有敌情压力，但队友只半推进（主力质心小幅位移后停止）。
- **AI 常见误判**：信号矛盾时仍强行判拖延或脱节。
- **正确判定（LLM 解释）**：**无法确定/低置信**——矛盾信号下 Backend 不硬判；是否拖延/脱节由 LLM 综合判断并保持不确定。
- **判定依据**：
  - 静止（拖延行为面）✓ 但有敌情压力；
  - 队友窗口内活动：只半推进（主力质心小幅位移后停止），不构成明确的时间利用关系；
  - 后端候选为空时按低置信处理，AI 明说无法确定。
- **对应 golden case**：`ai-eval/cases/cw-delay-vs-detach-ambiguous-01.json`
- **规则引用**：`SEPARATION_EVIDENCE_RULE`（证据不足/矛盾 → 无法确定）。
