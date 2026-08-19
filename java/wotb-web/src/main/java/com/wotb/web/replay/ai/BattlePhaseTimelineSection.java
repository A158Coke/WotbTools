package com.wotb.web.replay.ai;

import com.wotb.core.replay.feature.BattlePhaseSummary;

import java.util.List;

/**
 * 阶段时间线（阶段边界 + 双方存活人数）prompt 段渲染。
 * <p>团队复盘（single）与随机战（harness / fallback / 完整特征）共用同一渲染逻辑，
 * 只区分行风格：随机战行以「我方存活/敌方存活」中文标签（第二人称语境，不出现
 * 「录像者」），团队行沿用 OPPOSING_TEAM_LINEUP 的 friendly/enemy 机器键风格。
 * 人数来自 {@code SurvivalTimeline}（battle_results deathTimeMillis，缺失时事件流估算，
 * 来源见 DEATH_SOURCE 行），段内明确标注；某侧人数不可算时写「未知」/ UNKNOWN，
 * 禁止猜测；时间一律 X分XX秒，不出现裸秒数；不输出 raw team。</p>
 */
final class BattlePhaseTimelineSection {

    /**
     * 权威口径说明：随段头一起输出，禁止把观测子集伪装成全知。
     */
    static final String PHASE_SEMANTICS_NOTE =
            "注意: 每阶段双方存活人数是「阶段结束时」的存活数，不是阶段开始或之前某时刻的人数；"
                    + "不得据此断言某个时刻前某方已全灭。某侧人数不可算时写「未知」/ UNKNOWN，"
                    + "不得猜测或编造；死亡时刻来源见 DEATH_SOURCE 行，观测子集不得冒充全知。\n";

    private BattlePhaseTimelineSection() {
    }

    /**
     * 随机战完整段（段头 + 权威口径说明 + 行）。无阶段时返回空串。
     */
    static String renderPlayerSection(final List<BattlePhaseSummary> phases, final String deathSource) {
        final String rows = renderPlayerRows(phases);
        if (rows.isEmpty()) {
            return "";
        }
        return "=== 阶段时间线（双方存活人数） ===\n"
                + PHASE_SEMANTICS_NOTE
                + "DEATH_SOURCE=" + (deathSource == null || deathSource.isBlank() ? "未知" : deathSource) + "\n"
                + rows;
    }

    /**
     * 随机战行：X分XX秒 阶段名 | 我方存活 N 敌方存活 M（密集击杀）。
     */
    static String renderPlayerRows(final List<BattlePhaseSummary> phases) {
        if (phases == null || phases.isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(512);
        for (final BattlePhaseSummary phase : phases) {
            sb.append("  ").append(PlayerAnalysisTerms.battleRange(phase.startTime(), phase.endTime()))
                    .append(' ').append(PlayerAnalysisTerms.phaseLabel(phase.type()))
                    .append(" | 至阶段末 我方存活 ").append(aliveText(phase.friendlyAlive()))
                    .append(" 敌方存活 ").append(aliveText(phase.enemyAlive()))
                    .append(denseMarker(phase))
                    .append('\n');
        }
        return sb.toString();
    }

    /**
     * 团队行：friendly/enemy 机器键（与 OPPOSING_TEAM_LINEUP 一致），时间 X分XX秒。
     */
    static String renderTeamRows(final List<BattlePhaseSummary> phases) {
        if (phases == null || phases.isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(512);
        for (final BattlePhaseSummary phase : phases) {
            sb.append("phase[").append(PlayerAnalysisTerms.battleClock(phase.startTime()))
                    .append('-').append(PlayerAnalysisTerms.battleClock(phase.endTime())).append(']')
                    .append(" type=").append(PlayerAnalysisTerms.phaseLabel(phase.type()))
                    .append(" 阶段末friendlyAlive=").append(machineAliveText(phase.friendlyAlive()))
                    .append(" 阶段末enemyAlive=").append(machineAliveText(phase.enemyAlive()))
                    .append(" denseKills=").append(phase.denseKills())
                    .append(" confidence=").append(PlayerAnalysisTerms.confidenceLabel(phase.confidence()))
                    .append('\n');
        }
        return sb.toString();
    }

    /**
     * 人数不可算 → 中文「未知」，不猜。
     */
    private static String aliveText(final Integer alive) {
        return alive != null ? String.valueOf(alive) : "未知";
    }

    /**
     * 人数不可算 → UNKNOWN，不猜。
     */
    private static String machineAliveText(final Integer alive) {
        return alive != null ? String.valueOf(alive) : "UNKNOWN";
    }

    private static String denseMarker(final BattlePhaseSummary phase) {
        return phase.denseKills() ? "（密集击杀）" : "";
    }
}
