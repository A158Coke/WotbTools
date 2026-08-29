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
 * Personal AI Context Compiler：
 * 把 canonical BattleTimeline 编译为按时间的 Episode 化 compact 上下文，
 * 供 Call #2 主 prompt 使用（TACTICAL TIMELINE 段）。
 * <p>不 dump 全部帧；使用 Episode + Delta + Keyframe 压缩；只输出当时已知道的信息
 * （timeline 已满足 anti-future-leak）。输出 deterministic、可测试。</p>
 */
public final class PersonalAiContextCompiler {

    /** Episode 渲染上限（超出折叠为一行摘要，保证 token 有界）。 */
    static final int MAX_EPISODES = 14;
    /** 每个 Episode 的 delta 渲染上限。 */
    static final int MAX_DELTAS_PER_EPISODE = 8;

    private PersonalAiContextCompiler() {
    }

    /**
     * 渲染 TACTICAL TIMELINE 段（不含段落头）；timeline 为 null 时返回空串。
     *
     * @param recorderAccountId 录像者账号 id（用于标记「你」的状态）；null 时不做个人标注
     */
    public static String renderTimelineSection(
            final BattleTimeline timeline, final Long recorderAccountId) {
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

        // 首尾保留：高密度长战斗不丢残局关键决策；中间章节折叠为一行摘要
        final List<Integer> selected = selectedEpisodeIndices(episodes.size(), MAX_EPISODES);
        for (final int i : selected) {
            renderEpisode(sb, timeline, episodes.get(i), i, recorderAccountId);
        }
        if (selected.size() < episodes.size()) {
            sb.append("（中间 ").append(episodes.size() - selected.size())
                    .append(" 个章节略：信息密度低，未进入上下文）\n");
        }
        return sb.toString();
    }

    /**
     * Episode 选区（升序原始 index）：≤ maxEpisodes 全选；否则保留首部（ceil(max/2)）与
     * 尾部（floor(max/2)），中间折叠——残局关键决策不因截断丢失。
     */
    static List<Integer> selectedEpisodeIndices(final int episodeCount, final int maxEpisodes) {
        if (episodeCount <= maxEpisodes) {
            final List<Integer> all = new ArrayList<>(episodeCount);
            for (int i = 0; i < episodeCount; i++) {
                all.add(i);
            }
            return all;
        }
        final int head = (maxEpisodes + 1) / 2;
        final int tail = maxEpisodes - head;
        final List<Integer> out = new ArrayList<>(maxEpisodes);
        for (int i = 0; i < head; i++) {
            out.add(i);
        }
        for (int i = episodeCount - tail; i < episodeCount; i++) {
            out.add(i);
        }
        return out;
    }

    private static void renderEpisode(
            final StringBuilder sb,
            final BattleTimeline timeline,
            final TacticalEpisode ep,
            final int index,
            final Long recorderAccountId) {
        sb.append("EPISODE ").append(index + 1).append(" ")
                .append(PlayerAnalysisTerms.battleRange(
                        (float) ep.startSec(), (float) ep.endSec())).append("\n");

        final WorldSummary before = ep.before();
        final WorldSummary after = ep.after();
        sb.append("BEFORE friendly_alive=").append(before.friendlyAlive())
                .append(" enemy_alive=").append(before.enemyAlive())
                .append(" enemy_known=").append(before.enemyKnown())
                .append(" enemy_last_known=").append(before.enemyLastKnown())
                .append(" enemy_unknown=").append(before.enemyUnknown())
                .append("\n");

        // 录像者该时刻状态（knowledge-world）
        final FrameVehicle recorder = recorderAt(timeline, ep.startSec(), recorderAccountId);
        if (recorder != null) {
            sb.append("YOU ");
            if (recorder.health() != null && recorder.health().currentHp() != null) {
                sb.append("hp=").append(recorder.health().currentHp());
            }
            if (recorder.position() != null && recorder.position().position() != null) {
                final Integer region = recorder.mapState() == null ? null
                        : recorder.mapState().gridRegion();
                sb.append(" pos=").append(region != null
                        ? "GRID_REGION_" + region : "(" + Math.round(recorder.position().position().x())
                        + "," + Math.round(recorder.position().position().z()) + ")");
                if (recorder.position().positionAgeSec() != null
                        && recorder.position().positionAgeSec() > 0) {
                    sb.append(" age=").append(Math.round(recorder.position().positionAgeSec())).append("s");
                }
            }
            sb.append("\n");
        }

        // 事件/delta
        final List<String> lines = renderDeltas(timeline, ep, recorderAccountId);
        if (!lines.isEmpty()) {
            sb.append("EVENTS\n");
            for (final String line : lines) {
                sb.append("- ").append(line).append("\n");
            }
        }

        sb.append("AFTER friendly_alive=").append(after.friendlyAlive())
                .append(" enemy_alive=").append(after.enemyAlive())
                .append(" enemy_known=").append(after.enemyKnown())
                .append(" enemy_last_known=").append(after.enemyLastKnown())
                .append(" enemy_unknown=").append(after.enemyUnknown())
                .append("\n");

        if (!ep.tacticalChanges().isEmpty()) {
            final List<String> zh = new ArrayList<>();
            for (final String change : ep.tacticalChanges()) {
                zh.add(changeLabel(change));
            }
            sb.append("TACTICAL_CHANGE ").append(String.join("; ", zh)).append("\n");
        }
    }

    private static List<String> renderDeltas(
            final BattleTimeline timeline, final TacticalEpisode ep, final Long recorderAccountId) {
        final List<String> out = new ArrayList<>();
        int count = 0;
        // 确定性排序：按时间，再按 kind
        final List<BattleDelta> deltas = new ArrayList<>(ep.deltas());
        deltas.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                .thenComparing(d -> d.kind().name()));
        for (final BattleDelta d : deltas) {
            if (count >= MAX_DELTAS_PER_EPISODE) {
                out.add("（本段其余变化略）");
                break;
            }
            final String line = renderDelta(timeline, d, recorderAccountId);
            if (!line.isEmpty()) {
                out.add(line);
                count++;
            }
        }
        return out;
    }

    private static String renderDelta(
            final BattleTimeline timeline, final BattleDelta d, final Long recorderAccountId) {
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
                final double from = d.number("hpFrom", 0);
                final double to = d.number("hpTo", 0);
                return whoLabel(timeline, d, recorderAccountId) + " " + tank
                        + " HP " + Math.round(from) + "→" + Math.round(to);
            }
            case HP_GAP_DELTA -> {
                return whoLabel(timeline, d, recorderAccountId) + " " + tank
                        + " 信息空窗期损失约 " + Math.round(-d.number("hpDelta", 0))
                        + " HP（精确时刻/攻击者/原因未知，重亮后推断）";
            }
            case DESTROYED -> {
                return "车辆 " + tank + " 阵亡（当时已知）";
            }
            case REGION_CHANGE -> {
                return tank + " 进入 " + d.attr("toRegion", "新区域");
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
                final double fp = d.number("friendlyPoints", -1);
                final double ep2 = d.number("enemyPoints", -1);
                if ("friendly".equals(d.attr("side", ""))) {
                    return "你方点数 " + Math.round(fp);
                }
                return "敌方点数 " + Math.round(ep2);
            }
            case ENGAGEMENT_ACTIVITY -> {
                return "交火活动（窗口伤害 "
                        + Math.round(d.number("damageInWindow", 0)) + "）";
            }
            case POSITION_CHANGE -> {
                return tank + " 移动 " + Math.round(d.number("distanceM", 0)) + "m";
            }
            default -> {
                return "";
            }
        }
    }

    /**
     * HP 类 delta 的称谓（side 来自 delta 属性，绝不用文本猜测）：
     * friendly+录像者本人 → 「你」；friendly 其它 → 「队友」；enemy → 「敌方」。
     */
    private static String whoLabel(
            final BattleTimeline timeline, final BattleDelta d, final Long recorderAccountId) {
        if ("friendly".equals(d.attr("side", "enemy"))) {
            if (recorderAccountId != null && d.entityId() != null
                    && isRecorderEntity(timeline, d.entityId(), recorderAccountId)) {
                return "你";
            }
            return "队友";
        }
        return "敌方";
    }

    private static boolean isRecorderEntity(
            final BattleTimeline timeline, final int entityId, final long recorderAccountId) {
        final BattleFrame frame = timeline.frameAt(timeline.durationSec() / 2);
        if (frame == null) {
            return false;
        }
        for (final FrameVehicle v : frame.vehicles()) {
            if (v.entityId() == entityId) {
                return recorderAccountId == (v.accountId() == null ? -1L : v.accountId());
            }
        }
        return false;
    }

    /** Episode tacticalChanges 短标签 → 中文（结构化标签不进入 prompt）。 */
    static String changeLabel(final String change) {
        if (change == null || change.isBlank()) {
            return "";
        }
        return switch (change) {
            case "FIRST_CONTACT" -> "首次接敌";
            case "DESTROYED" -> "有车辆阵亡";
            case "NEW_ENEMY_INFO" -> "获得新的敌方信息";
            case "ENEMY_LOST" -> "敌方失联";
            case "ENEMY_REACQUIRED" -> "敌方重新出现";
            case "HP_GAP_DELTA" -> "信息空窗期 HP 变化";
            case "POINTS_CHANGE" -> "点数变化";
            case "ROTATION" -> "转场";
            default -> {
                if (change.startsWith("ALIVE ")) {
                    yield "存活 " + change.substring("ALIVE ".length());
                }
                if (change.startsWith("ENGAGEMENT dmg=")) {
                    yield "交火（伤害 " + change.substring("ENGAGEMENT dmg=".length()) + "）";
                }
                yield change;
            }
        };
    }

    private static FrameVehicle recorderAt(
            final BattleTimeline timeline, final double t, final Long recorderAccountId) {
        if (recorderAccountId == null || timeline == null) {
            return null;
        }
        final BattleFrame frame = timeline.frameAt(t);
        if (frame == null) {
            return null;
        }
        return frame.vehicles().stream()
                .filter(v -> recorderAccountId.equals(v.accountId()))
                .findFirst().orElse(null);
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
