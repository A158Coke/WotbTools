package com.wotb.web.replay.job;

import java.util.Map;

/**
 * League 战队名称覆盖快照（Export Job 创建时从请求复制，不可变）。
 *
 * <p>两种独立 identity（PR #123 Blocker 2，禁止混用一个扁平 Map）：</p>
 * <ul>
 *   <li>{@link #battle()}：单场 override，key = {@code {arenaId}:{team}} → 显示名。
 *       用于单场显示 / 单场 PNG / 单场与 each Excel。</li>
 *   <li>{@link #summary()}：批次战队 identity override，key = {@code teamKey}（如 {@code clan:CHRD}）→ 显示名。
 *       用于批次战队汇总显示 / aggregate Excel 战队汇总。</li>
 * </ul>
 *
 * <p>优先级：单场 battle override → autoName → 待命名；批次 teamKey override → autoName → 待命名。
 * 批次 rename 不得反向写入所有 {@code arenaId:team}。</p>
 */
public record TeamNameOverrides(Map<String, String> battle, Map<String, String> summary) {

    public TeamNameOverrides {
        battle = battle == null ? Map.of() : Map.copyOf(battle);
        summary = summary == null ? Map.of() : Map.copyOf(summary);
    }

    public static TeamNameOverrides empty() {
        return new TeamNameOverrides(Map.of(), Map.of());
    }

    public boolean isEmpty() {
        return battle.isEmpty() && summary.isEmpty();
    }
}
