package com.wotb.web.replay.ai;

import com.wotb.core.replay.timeline.BattleDelta;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.EpisodeDetector;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.TacticalEpisode;
import com.wotb.core.replay.timeline.WorldSummary;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Team AI Context Compiler（docs/current-plan.md §29/§51）：
 * 把 canonical BattleTimeline 编译为团队视角的 Episode 化上下文——双方对称
 * （friendly deployment / enemy knowledge / local force / HP momentum / points）。
 * actor = perspectiveTeam，不以录像者为中心。
 */
public final class TeamAiContextCompiler {

    static final int MAX_EPISODES = 14;
    static final int MAX_DELTAS_PER_EPISODE = 8;

    private TeamAiContextCompiler() {
    }

    public static String renderTimelineSection(final BattleTimeline timeline, final int perspectiveTeam) {
        if (timeline == null || timeline.frames() == null || timeline.frames().isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(4096);
        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        if (episodes.isEmpty()) {
            return "";
        }
        sb.append("战斗总时长: ").append(PlayerAnalysisTerms.battleClock(
                (float) timeline.durationSec())).append("\n");
        if (timeline.clockResolution() != null
                && timeline.clockResolution().name().equals("ESTIMATED")) {
            sb.append("时间轴: battle-relative（由战斗结束事件推算，确定性）\n");
        }

        // 首尾保留：高密度长战斗不丢残局关键决策；中间章节折叠为一行摘要（P1 review）
        final java.util.List<Integer> selected =
                PersonalAiContextCompiler.selectedEpisodeIndices(episodes.size(), MAX_EPISODES);
        for (final int i : selected) {
            renderEpisode(sb, timeline, episodes.get(i), i, perspectiveTeam);
        }
        if (selected.size() < episodes.size()) {
            sb.append("（中间 ").append(episodes.size() - selected.size())
                    .append(" 个章节略：信息密度低，未进入上下文）\n");
        }
        return sb.toString();
    }

    private static void renderEpisode(
            final StringBuilder sb,
            final BattleTimeline timeline,
            final TacticalEpisode ep,
            final int index,
            final int perspectiveTeam) {
        sb.append("EPISODE ").append(index + 1).append(" ")
                .append(PlayerAnalysisTerms.battleRange(
                        (float) ep.startSec(), (float) ep.endSec())).append("\n");

        final WorldSummary before = ep.before();
        final WorldSummary after = ep.after();
        sb.append("BEFORE 我方_alive=").append(before.friendlyAlive())
                .append(" 敌方_alive=").append(before.enemyAlive())
                .append(" 敌方_known=").append(before.enemyKnown())
                .append(" 敌方_last_known=").append(before.enemyLastKnown())
                .append(" 敌方_unknown=").append(before.enemyUnknown())
                .append("\n");

        final List<String> lines = renderDeltas(timeline, ep, perspectiveTeam);
        if (!lines.isEmpty()) {
            sb.append("EVENTS\n");
            for (final String line : lines) {
                sb.append("- ").append(line).append("\n");
            }
        }

        sb.append("AFTER 我方_alive=").append(after.friendlyAlive())
                .append(" 敌方_alive=").append(after.enemyAlive())
                .append(" 敌方_known=").append(after.enemyKnown())
                .append(" 敌方_last_known=").append(after.enemyLastKnown())
                .append(" 敌方_unknown=").append(after.enemyUnknown())
                .append("\n");

        if (!ep.tacticalChanges().isEmpty()) {
            final List<String> zh = new ArrayList<>();
            for (final String change : ep.tacticalChanges()) {
                zh.add(PersonalAiContextCompiler.changeLabel(change));
            }
            sb.append("TACTICAL_CHANGE ").append(String.join("; ", zh)).append("\n");
        }
    }

    private static List<String> renderDeltas(
            final BattleTimeline timeline, final TacticalEpisode ep, final int perspectiveTeam) {
        final List<String> out = new ArrayList<>();
        int count = 0;
        final List<BattleDelta> deltas = new ArrayList<>(ep.deltas());
        deltas.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                .thenComparing(d -> d.kind().name()));
        for (final BattleDelta d : deltas) {
            if (count >= MAX_DELTAS_PER_EPISODE) {
                out.add("（本段其余变化略）");
                break;
            }
            final String line = renderDelta(timeline, d, perspectiveTeam);
            if (!line.isEmpty()) {
                out.add(line);
                count++;
            }
        }
        return out;
    }

    private static String renderDelta(
            final BattleTimeline timeline, final BattleDelta d, final int perspectiveTeam) {
        final String tank = tankLabel(timeline, d.entityId());
        switch (d.kind()) {
            case FIRST_CONTACT -> {
                return "首次接敌";
            }
            case FIRST_KNOWN -> {
                return "敌方 " + tank + " 首次出现";
            }
            case ENEMY_LOST -> {
                return "敌方 " + tank + " 位置流中断（last-known "
                        + Math.round(d.number("ageSec", 0)) + "秒）";
            }
            case ENEMY_REACQUIRED -> {
                return "敌方 " + tank + " 重新出现";
            }
            case HP_CHANGE -> {
                return whoLabel(d) + " " + tank + " HP "
                        + Math.round(d.number("hpFrom", 0)) + "→" + Math.round(d.number("hpTo", 0));
            }
            case HP_GAP_DELTA -> {
                return whoLabel(d) + " " + tank + " 信息空窗期损失约 "
                        + Math.round(-d.number("hpDelta", 0)) + " HP（精确时刻/攻击者/原因未知）";
            }
            case DESTROYED -> {
                return "车辆 " + tank + " 阵亡（当时已知）";
            }
            case ALIVE_COUNT_CHANGE -> {
                final double f = d.number("friendlyAlive", -1);
                final double e = d.number("enemyAlive", -1);
                return f >= 0 && e >= 0
                        ? "双方存活 " + Math.round(f) + "v" + Math.round(e)
                        : "存活人数变化";
            }
            case LOCAL_FORCE_CHANGE -> {
                return "敌方已知 " + Math.round(d.number("enemyKnown", 0))
                        + " / last-known " + Math.round(d.number("enemyLastKnown", 0))
                        + " / 未知 " + Math.round(d.number("enemyUnknown", 0));
            }
            case POINTS_CHANGE -> {
                if ("friendly".equals(d.attr("side", ""))) {
                    return "我方点数 " + Math.round(d.number("friendlyPoints", 0));
                }
                return "敌方点数 " + Math.round(d.number("enemyPoints", 0));
            }
            case ENGAGEMENT_ACTIVITY -> {
                return "交火活动（窗口伤害 "
                        + Math.round(d.number("damageInWindow", 0)) + "）";
            }
            case POSITION_CHANGE -> {
                return tank + " 移动 " + Math.round(d.number("distanceM", 0)) + "m";
            }
            case REGION_CHANGE -> {
                return tank + " 进入 " + d.attr("toRegion", "新区域");
            }
            default -> {
                return "";
            }
        }
    }

    /** HP 类 delta 称谓：side 来自 delta 属性（friendly → 我方 / enemy → 敌方）。 */
    private static String whoLabel(final BattleDelta d) {
        return "friendly".equals(d.attr("side", "enemy")) ? "我方" : "敌方";
    }

    private static String tankLabel(final BattleTimeline timeline, final Integer entityId) {
        if (entityId == null || timeline == null) {
            return "未知车辆";
        }
        final BattleFrame frame = timeline.frameAt(timeline.durationSec() / 2);
        if (frame != null) {
            final FrameVehicle v = frame.vehicles().stream()
                    .filter(fv -> fv.entityId() == entityId)
                    .findFirst().orElse(null);
            if (v != null && v.tankName() != null && !v.tankName().isBlank()) {
                return v.tankName();
            }
        }
        return "车辆#" + entityId;
    }
}
