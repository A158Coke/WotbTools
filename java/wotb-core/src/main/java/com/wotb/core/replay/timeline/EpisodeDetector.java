package com.wotb.core.replay.timeline;

import java.util.ArrayList;
import java.util.List;

/**
 * 确定性 Episode 切分器（docs/current-plan.md §23）。
 * <p>禁止固定 30 秒机械切块；关键战术变化优先于固定长度：
 * 强信号（首次接敌/阵亡/存活人数变化/点数变化/信息空窗 HP 差异）触发切分，
 * 同时受时长约束（首选 15–45s，硬最小 8s，硬最大 60s）。覆盖整场、连续、无重叠。</p>
 */
public final class EpisodeDetector {

    /** 硬最小章节时长（秒）。 */
    public static final double MIN_EPISODE_SEC = 8.0;
    /** 首选最大章节时长（秒）。 */
    public static final double PREFERRED_MAX_SEC = 45.0;
    /** 硬最大章节时长（秒）。 */
    public static final double HARD_MAX_SEC = 60.0;
    /** 静默间隙（秒）：超过视为安静期，可切分。 */
    public static final double QUIET_GAP_SEC = 10.0;

    private EpisodeDetector() {
    }

    /**
     * 对 timeline 切分 episode；timeline 为 null / 无帧时返回空列表。
     */
    public static List<TacticalEpisode> detect(final BattleTimeline timeline) {
        if (timeline == null || timeline.frames() == null || timeline.frames().isEmpty()) {
            return List.of();
        }
        final int maxSecond = timeline.frames().size() - 1;
        final double endSec = Math.max(0, timeline.durationSec() < maxSecond
                ? maxSecond : timeline.durationSec());
        if (endSec <= 0) {
            return List.of();
        }

        // 逐秒聚合 delta（按 frame second）
        final List<List<BattleDelta>> deltasBySecond = new ArrayList<>(maxSecond + 1);
        for (int i = 0; i <= maxSecond; i++) {
            deltasBySecond.add(new ArrayList<>());
        }
        int lastDeltaSecond = -1;
        for (final BattleFrame frame : timeline.frames()) {
            if (frame.deltas() == null || frame.deltas().isEmpty()) {
                continue;
            }
            deltasBySecond.get(frame.second()).addAll(frame.deltas());
            lastDeltaSecond = Math.max(lastDeltaSecond, frame.second());
        }

        // 边界强度评分
        final double[] scores = new double[maxSecond + 1];
        for (int s = 0; s <= maxSecond; s++) {
            double score = 0;
            int destroyed = 0;
            int firstKnown = 0;
            int reacquired = 0;
            for (final BattleDelta d : deltasBySecond.get(s)) {
                switch (d.kind()) {
                    case FIRST_CONTACT -> score += 3;
                    case DESTROYED -> destroyed++;
                    case ALIVE_COUNT_CHANGE -> score += 2;
                    case HP_GAP_DELTA -> score += 2;
                    case FIRST_KNOWN -> firstKnown++;
                    case ENEMY_REACQUIRED -> reacquired++;
                    case POINTS_CHANGE -> score += 1;
                    case ENGAGEMENT_ACTIVITY -> {
                        score += 1;
                        if (d.number("damageInWindow", 0) >= 200) {
                            score += 1;
                        }
                    }
                    default -> {
                        // 其它 delta 不构成强切分信号
                    }
                }
            }
            score += Math.min(2, destroyed);
            score += Math.min(2, firstKnown);
            score += Math.min(2, reacquired);
            scores[s] = score;
        }

        // 贪心切分：segment = [start, end) 半开秒区间（end 排他；最后一段 end = maxSecond+1）。
        // 区间契约：每个 second 的 delta 恰好属于一个 segment（边界秒不重复）。
        final List<int[]> raw = new ArrayList<>(); // [start, endExclusive)
        int start = 0;
        int lastDeltaSeen = 0; // 开局无 delta 历史：从 0 起算 quiet gap
        for (int s = 0; s <= maxSecond; s++) {
            final double length = s - start;
            final double elapsedSinceDelta = s - lastDeltaSeen;
            final boolean strongSignal = scores[s] >= 3.0 && length >= MIN_EPISODE_SEC;
            final boolean quietGap = elapsedSinceDelta >= QUIET_GAP_SEC
                    && length >= MIN_EPISODE_SEC && deltasBySecond.get(s).isEmpty();
            final boolean tooLong = length >= HARD_MAX_SEC;
            final boolean preferredReached = length >= PREFERRED_MAX_SEC
                    && (scores[s] >= 1.0 || s == maxSecond);
            if (s > start && (strongSignal || quietGap || tooLong || preferredReached)) {
                raw.add(new int[]{start, s});
                start = s;
                lastDeltaSeen = s;
            }
            if (!deltasBySecond.get(s).isEmpty()) {
                lastDeltaSeen = s;
            }
        }
        if (start < maxSecond || raw.isEmpty()) {
            raw.add(new int[]{start, Math.max(start + 1, maxSecond + 1)});
        }

        // 合并过短 episode（< MIN）
        final List<int[]> merged = new ArrayList<>();
        for (final int[] seg : raw) {
            if (merged.isEmpty()) {
                merged.add(seg);
                continue;
            }
            final int[] prev = merged.get(merged.size() - 1);
            final double prevLen = prev[1] - prev[0];
            final double curLen = seg[1] - seg[0];
            if (curLen < MIN_EPISODE_SEC && (prevLen + curLen) <= HARD_MAX_SEC) {
                prev[1] = seg[1];
            } else {
                merged.add(seg);
            }
        }
        if (merged.size() > 1 && (merged.get(0)[1] - merged.get(0)[0]) < MIN_EPISODE_SEC) {
            final int[] first = merged.get(0);
            final int[] second = merged.get(1);
            if ((second[1] - first[0]) <= HARD_MAX_SEC) {
                first[1] = second[1];
                merged.remove(1);
            }
        }

        // 组装：segment [start, endExclusive) → episode [startSec, endSec]，最后包含秒 = endExclusive-1
        final List<TacticalEpisode> episodes = new ArrayList<>();
        int idx = 0;
        for (final int[] seg : merged) {
            final double s = seg[0];
            final int lastInclusiveSecond = Math.min(seg[1] - 1, maxSecond);
            final double e = Math.max(s + MIN_EPISODE_SEC, lastInclusiveSecond + 1.0);
            final WorldSummary before = frameWorld(timeline, seg[0]);
            final WorldSummary after = frameWorld(timeline, lastInclusiveSecond);
            final List<BattleDelta> deltas = collectDeltas(deltasBySecond, seg[0], seg[1]);
            episodes.add(new TacticalEpisode(
                    idx++, s, Math.min(e, endSec), before, after,
                    List.copyOf(deltas),
                    List.copyOf(changes(deltas)),
                    List.of()));
        }
        return List.copyOf(episodes);
    }

    private static WorldSummary frameWorld(final BattleTimeline timeline, final int second) {
        final BattleFrame frame = timeline.frameAt(second);
        return frame == null ? WorldSummary.EMPTY : frame.world();
    }

    /** 半开区间 [startSecond, endExclusiveSecond) 收集 delta：边界秒只归前一段（无重复）。 */
    private static List<BattleDelta> collectDeltas(
            final List<List<BattleDelta>> deltasBySecond,
            final int startSecond,
            final int endExclusiveSecond) {
        final List<BattleDelta> out = new ArrayList<>();
        for (int s = Math.max(0, startSecond); s < endExclusiveSecond && s < deltasBySecond.size(); s++) {
            out.addAll(deltasBySecond.get(s));
        }
        return out;
    }

    /** 确定性短标签（供 Context Compiler 渲染；结构化，不编造）。 */
    static List<String> changes(final List<BattleDelta> deltas) {
        final List<String> out = new ArrayList<>();
        for (final BattleDelta d : deltas) {
            switch (d.kind()) {
                case FIRST_CONTACT -> out.add("FIRST_CONTACT");
                case DESTROYED -> out.add("DESTROYED");
                case ALIVE_COUNT_CHANGE -> {
                    final double f = d.number("friendlyAlive", -1);
                    final double e = d.number("enemyAlive", -1);
                    if (f >= 0 && e >= 0) {
                        out.add("ALIVE " + (int) f + "v" + (int) e);
                    }
                }
                case FIRST_KNOWN -> out.add("NEW_ENEMY_INFO");
                case ENEMY_REACQUIRED -> out.add("ENEMY_REACQUIRED");
                case ENEMY_LOST -> out.add("ENEMY_LOST");
                case HP_GAP_DELTA -> out.add("HP_GAP_DELTA");
                case POINTS_CHANGE -> out.add("POINTS_CHANGE");
                case ENGAGEMENT_ACTIVITY -> out.add("ENGAGEMENT dmg="
                        + Math.round(d.number("damageInWindow", 0)));
                case REGION_CHANGE -> out.add("ROTATION");
                default -> {
                    // 其它 delta 不产生章节标签
                }
            }
        }
        return out;
    }
}
