package com.wotb.web.replay.ai;

import com.wotb.core.replay.timeline.BattleDelta;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.DeltaKind;
import com.wotb.core.replay.timeline.EpisodeDetector;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.TacticalEpisode;
import com.wotb.core.replay.timeline.TimelineFocusWindowSelector;
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


    /**
     * 渲染 TEAM REVIEW FOCUS WINDOWS 段（确定性，docs/current-plan.md §4/§5）：
     * 1–3 个信息密度最高的决策窗口，每个窗口输出 BEFORE / EVENTS / AFTER /
     * OBSERVED FACTS / EVIDENCE LIMITATIONS。全部来自已验证 canonical timeline，
     * 不编造战术原因；timeline 为 null 或无可选窗口时返回空串。
     */
    static String renderFocusWindowsSection(final BattleTimeline timeline, final int perspectiveTeam) {
        if (timeline == null) {
            return "";
        }
        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        if (windows.isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== TEAM REVIEW FOCUS WINDOWS（1-3 个信息密度最高的决策窗口·确定性） ===\n");
        int index = 1;
        for (final TimelineFocusWindowSelector.FocusWindow w : windows) {
            sb.append("WINDOW ").append(index++).append(" time=")
                    .append(PlayerAnalysisTerms.battleRange(
                            (float) w.startSec(), (float) w.endSec())).append("\n");
            sb.append("BEFORE 我方_alive=").append(w.before().friendlyAlive())
                    .append(" 敌方_alive=").append(w.before().enemyAlive())
                    .append(" 敌方_known=").append(w.before().enemyKnown())
                    .append(" 敌方_last_known=").append(w.before().enemyLastKnown())
                    .append(" 敌方_unknown=").append(w.before().enemyUnknown())
                    .append("\n");
            if (!w.events().isEmpty()) {
                sb.append("EVENTS\n");
                // P0-10：窗口事件上限（避免 FOCUS WINDOWS 段被海量移动事件撑爆 prompt，
                // 生产实测该段 13.4k 字符 ≈ 16.8k tokens）。优先保留高信息事件
                // （阵亡/存活/HP/区域/接敌），移动/位置类事件折叠为一行摘要。
                final List<BattleDelta> highInfo = w.events().stream()
                        .filter(TeamAiContextCompiler::isHighInfoDelta)
                        .toList();
                final List<BattleDelta> lowInfo = w.events().stream()
                        .filter(d -> !isHighInfoDelta(d))
                        .toList();
                int rendered = 0;
                for (final BattleDelta d : highInfo) {
                    if (rendered >= MAX_DELTAS_PER_EPISODE) {
                        break;
                    }
                    final String line = renderDelta(timeline, d, perspectiveTeam);
                    if (!line.isEmpty()) {
                        sb.append("- ").append(line).append("\n");
                        rendered++;
                    }
                }
                if (rendered < MAX_DELTAS_PER_EPISODE && !lowInfo.isEmpty()) {
                    final String line = renderDelta(timeline, lowInfo.get(0), perspectiveTeam);
                    if (!line.isEmpty()) {
                        sb.append("- ").append(line).append("\n");
                        rendered++;
                    }
                }
                final int omitted = w.events().size() - rendered;
                if (omitted > 0) {
                    sb.append("- （窗口内其余 ").append(omitted).append(" 个事件略）\n");
                }
            }
            sb.append("AFTER 我方_alive=").append(w.after().friendlyAlive())
                    .append(" 敌方_alive=").append(w.after().enemyAlive())
                    .append(" 敌方_known=").append(w.after().enemyKnown())
                    .append(" 敌方_last_known=").append(w.after().enemyLastKnown())
                    .append(" 敌方_unknown=").append(w.after().enemyUnknown())
                    .append("\n");
            sb.append("OBSERVED FACTS\n");
            if (w.friendlyDeaths() > 0 || w.enemyDeaths() > 0) {
                sb.append("- 本方阵亡 ").append(w.friendlyDeaths())
                        .append(" 辆，对方阵亡 ").append(w.enemyDeaths()).append(" 辆\n");
            }
            if (w.before().friendlyAlive() != w.after().friendlyAlive()
                    || w.before().enemyAlive() != w.after().enemyAlive()) {
                sb.append("- 双方存活 ").append(w.before().friendlyAlive())
                        .append("v").append(w.before().enemyAlive())
                        .append(" → ").append(w.after().friendlyAlive())
                        .append("v").append(w.after().enemyAlive()).append("\n");
            }
            if (w.hpSwingObserved()) {
                sb.append("- HP 变化合计约 ").append(Math.round(w.hpSwing()))
                        .append("（事件流观测子集，非权威结算）\n");
            }
            if (w.engagementObserved()) {
                sb.append("- 交火活动伤害约 ").append(w.engagementDamage())
                        .append("（事件流观测子集）\n");
            }
            if (w.pointsChanged()) {
                sb.append("- 点数发生变化（实时点数未解码，只表示存在变化）\n");
            }
            if (w.firstContact()) {
                sb.append("- 首次接敌\n");
            }
            sb.append("EVIDENCE LIMITATIONS\n");
            sb.append("- 阵亡时刻为当时已知事实；事件流伤害/HP 为观测子集，非权威结算。\n");
            final boolean gapHp = w.events().stream()
                    .anyMatch(d -> d.kind() == DeltaKind.HP_GAP_DELTA);
            if (gapHp) {
                sb.append("- 部分 HP 变化为信息空窗后推断（精确时刻/攻击者/原因未知）。\n");
            }
            sb.append("- 当前证据无法证明具体原因（掩体使用/射界/视野/指挥沟通/个人操作），不得据此编造归因。\n");
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

    /** P0-10：高信息事件（保留渲染）——阵亡/存活/HP/区域/接敌/失联/点数；移动类折叠。 */
    private static boolean isHighInfoDelta(final BattleDelta d) {
        return switch (d.kind()) {
            case DESTROYED, ALIVE_COUNT_CHANGE, HP_CHANGE, HP_GAP_DELTA,
                 REGION_CHANGE, FIRST_CONTACT, FIRST_KNOWN, ENEMY_LOST,
                 ENEMY_REACQUIRED, POINTS_CHANGE, ENGAGEMENT_ACTIVITY,
                 LOCAL_FORCE_CHANGE -> true;
            default -> false;
        };
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