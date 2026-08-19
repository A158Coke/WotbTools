# AI Lesson：player-partial-overlap-strong-signals-01 — 部分重叠交火不得靠强信号硬判

- **案例 id**：`player-partial-overlap-strong-signals-01`
- **场景**：录像者交火 40-65s（承伤 1000）与单走窗口 60-75s 部分重叠，且窗口内持续拉大距离。
- **AI/后端常见误判**：把部分重叠交火的整段承伤算进窗口，越过 800 阈值误判脱节。
- **正确判定**：无候选（部分重叠交火无法可靠归属：不把整段承伤计入，也不得依靠其他强信号硬生成拖延/脱节）。
- **判定依据**：`PlayerSeparationEvidenceSkill.classify` 对部分重叠交火直接返回空候选（同 Team 路径保守原则）。
- **对应 golden case**：`ai-eval/cases/player-partial-overlap-strong-signals-01.json`
- **规则引用**：player `SEPARATION_EVIDENCE_RULE`（证据不足/矛盾 → 无法确定）。
