# AI Lesson：player-thin-coverage-01 — 移动覆盖不足 ≠ MOVING

- **案例 id**：`player-thin-coverage-01`
- **场景**：随机战，15s 单走窗口只有 1s 移动证据覆盖，窗口内有承伤 1800。
- **AI/后端常见误判**：只要有任何移动覆盖就按 MOVING 处理，结合承伤误判脱节。
- **正确判定**：无候选（`coveredDuration / spanDuration` 低于门控 → `stationaryRatio=UNKNOWN`，不判 MOVING 也不判 STATIONARY）。
- **判定依据**：`SoloPlayIntentSkill.stationaryRatio` 覆盖率门控（`MIN_MOVEMENT_COVERAGE_RATIO=0.5`）。
- **对应 golden case**：`ai-eval/cases/player-thin-coverage-01.json`
- **规则引用**：player `SOLO_INTENT_RULE`（证据不足/矛盾 → 无法确定）。
