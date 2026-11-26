package com.wotb.ai.review;

import com.wotb.core.replay.feature.BattlePhaseSummary;

import java.util.List;

final class BattlePhaseTimelineSection {

    static final String PHASE_SEMANTICS_NOTE =
            "注意: 每阶段双方存活人数是「阶段结束时」的存活数，不是阶段开始或之前某时刻的人数；"
                    + "不得据此断言某个时刻前某方已全灭。某侧人数不可算时写「未知」/ UNKNOWN，"
                    + "不得猜测或编造；死亡时刻只使用结算秒级事实，观测子集不得冒充全知。\n";

    private BattlePhaseTimelineSection() {
    }

    static String renderPlayerSection(final List<BattlePhaseSummary> phases) {
        final String rows = renderPlayerRows(phases);
        if (rows.isEmpty()) {
            return "";
        }
        return "=== 阶段时间线（双方存活人数） ===\n"
                + PHASE_SEMANTICS_NOTE + rows;
    }

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

    private static String aliveText(final Integer alive) {
        return alive != null ? String.valueOf(alive) : "未知";
    }

    private static String machineAliveText(final Integer alive) {
        return alive != null ? String.valueOf(alive) : "UNKNOWN";
    }

    private static String denseMarker(final BattlePhaseSummary phase) {
        return phase.denseKills() ? "（密集击杀）" : "";
    }
}
