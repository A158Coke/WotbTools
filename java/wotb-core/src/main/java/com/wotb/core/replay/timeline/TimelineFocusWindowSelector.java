package com.wotb.core.replay.timeline;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * 团队复盘 Focus Window 选择器（确定性、小型，docs/current-plan.md §4/§5）。
 * <p>从 canonical {@link BattleTimeline} 的 delta 流中选出 1–3 个<b>信息密度最高</b>的
 * 决策窗口（Team Review Focus Window），供团队复盘 Prompt 注入 BEFORE/EVENTS/AFTER。
 * 与 {@link EpisodeDetector} 的差异：Episode 覆盖整场、连续、无重叠；Focus Window 是
 * 分析局部战术问题的观察窗口，只选信息密度最高的一段，允许跨 Episode。</p>
 * <p><b>识别目标</b>：短时间连续减员（如 1分52秒–2分12秒 内本方 3 死对方 1 死）必须
 * 成为最高优先窗口；无阵亡时仍能通过 HP swing / 点数变化 / 首次接敌 / 交火活动选出
 * 有意义的窗口。只输出 canonical facts，绝不编造战术原因。</p>
 * <p><b>约束</b>：窗口 events 只含窗口时间范围内的 delta；BEFORE/AFTER 取对应秒的
 * knowledge-world 状态（timeline 已满足 anti-future-leak）；不重复 delta、不 future leak。
 * 不构建第二套战场事实模型，全部消费已验证 timeline。</p>
 */
public final class TimelineFocusWindowSelector {

    /** 输出窗口上限（1–3）。 */
    public static final int MAX_WINDOWS = 3;
    /** 连续减员合并间隔（秒）：相邻阵亡间隔不超过该值视为同一次连续减员（短时间连续减员）。 */
    public static final double DEATH_MERGE_GAP_SEC = 20.0;
    /** 单窗口核心跨度上限（秒）：超过后在最大间隔处拆分，避免整场死亡链合并成超大窗口。 */
    static final double MAX_CLUSTER_SPAN_SEC = 40.0;
    /** 窗口前后填充（秒）：吸收减员前后的伴随信号（掉血/交火/点数/存活变化）。 */
    static final double PADDING_SEC = 15.0;
    /** 非阵亡候选窗口的最低信息分（低于则不出现在输出中；单独一次首次接敌不算关键窗口）。 */
    static final double MIN_CANDIDATE_SCORE = 120.0;

    private TimelineFocusWindowSelector() {
    }

    /** 一个 Team Review Focus Window（全部字段来自 canonical timeline，确定性）。 */
    public record FocusWindow(
            double startSec,
            double endSec,
            WorldSummary before,
            WorldSummary after,
            List<BattleDelta> events,
            int friendlyDeaths,
            int enemyDeaths,
            boolean hpSwingObserved,
            double hpSwing,
            boolean engagementObserved,
            int engagementDamage,
            boolean pointsChanged,
            boolean firstContact,
            List<String> reasons
    ) {
        public FocusWindow {
            events = events == null ? List.of() : List.copyOf(events);
            reasons = reasons == null ? List.of() : List.copyOf(reasons);
        }

        public double durationSec() {
            return endSec - startSec;
        }
    }

    /**
     * 从已验证 canonical timeline 选择 1–3 个 Focus Window；timeline 为 null / 无帧 /
     * 无有意义信号时返回空列表。
     */
    public static List<FocusWindow> select(final BattleTimeline timeline) {
        if (timeline == null || timeline.frames() == null || timeline.frames().isEmpty()) {
            return List.of();
        }
        final List<BattleDelta> all = new ArrayList<>();
        for (final BattleFrame frame : timeline.frames()) {
            if (frame.deltas() == null || frame.deltas().isEmpty()) {
                continue;
            }
            for (final BattleDelta d : frame.deltas()) {
                if (d.timeSec() >= 0 && d.timeSec() <= timeline.durationSec()) {
                    all.add(d);
                }
            }
        }
        all.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                .thenComparing(d -> d.kind().name()));
        if (all.isEmpty()) {
            return List.of();
        }

        // 候选窗口 = 死亡簇（核心信号）∪ 死亡簇之外的非死亡高信息簇
        final List<Candidate> candidates = new ArrayList<>();
        candidates.addAll(deathClusters(timeline, all));
        candidates.addAll(nonDeathClusters(timeline, all, candidates));
        final List<Candidate> merged = mergeOverlapping(timeline, candidates);

        final List<Candidate> ranked = merged.stream()
                .filter(TimelineFocusWindowSelector::hasSignal)
                .sorted(Comparator
                        .comparingDouble((Candidate c) -> score(c))
                        .reversed()
                        .thenComparingDouble(c -> c.coreStartSec))
                .toList();
        final List<FocusWindow> out = new ArrayList<>();
        for (final Candidate c : ranked) {
            if (out.size() >= MAX_WINDOWS) {
                break;
            }
            if (out.stream().noneMatch(w -> overlaps(w.startSec(), w.endSec(), c.startSec, c.endSec))) {
                out.add(toWindow(timeline, c));
            }
        }
        out.sort(Comparator.comparingDouble(FocusWindow::startSec));
        return List.copyOf(out);
    }

    // ===== 候选构建 =====

    private record Candidate(
            double coreStartSec,
            double coreEndSec,
            double startSec,
            double endSec,
            List<BattleDelta> events,
            int friendlyDeaths,
            int enemyDeaths,
            double hpSwing,
            int engagementDamage,
            boolean pointsChanged,
            boolean firstContact,
            int aliveChanges
    ) {
    }

    /** 死亡簇：相邻阵亡间隔 ≤ DEATH_MERGE_GAP_SEC 合并；长链按最大间隔拆分。 */
    private static List<Candidate> deathClusters(final BattleTimeline timeline, final List<BattleDelta> all) {
        final List<List<BattleDelta>> clusters = new ArrayList<>();
        List<BattleDelta> cluster = null;
        double lastDeathTime = -1;
        for (final BattleDelta d : all) {
            if (d.kind() != DeltaKind.DESTROYED) {
                continue;
            }
            if (cluster == null || d.timeSec() - lastDeathTime > DEATH_MERGE_GAP_SEC) {
                cluster = new ArrayList<>();
                clusters.add(cluster);
            }
            cluster.add(d);
            lastDeathTime = d.timeSec();
        }
        final List<Candidate> out = new ArrayList<>();
        for (final List<BattleDelta> c : clusters) {
            for (final List<BattleDelta> piece : splitLongCluster(c)) {
                out.add(buildCandidate(timeline, all, piece));
            }
        }
        return out;
    }

    /**
     * 非死亡高信息簇：只取<b>未被死亡候选覆盖</b>的显著非死亡 delta（HP/点数/接敌/交火/存活变化），
     * 避免与死亡窗口重复；按相同间隔合并、长链拆分，保证「正常交火 + 点数/HP swing」也能选出窗口。
     */
    private static List<Candidate> nonDeathClusters(
            final BattleTimeline timeline,
            final List<BattleDelta> all,
            final List<Candidate> deathCandidates) {
        final List<List<BattleDelta>> clusters = new ArrayList<>();
        List<BattleDelta> cluster = null;
        double lastTime = -1;
        for (final BattleDelta d : all) {
            if (d.kind() == DeltaKind.DESTROYED || !significantNonDeath(d)) {
                continue;
            }
            if (coveredByDeathWindow(d.timeSec(), deathCandidates)) {
                continue;
            }
            if (cluster == null || d.timeSec() - lastTime > DEATH_MERGE_GAP_SEC) {
                cluster = new ArrayList<>();
                clusters.add(cluster);
            }
            cluster.add(d);
            lastTime = d.timeSec();
        }
        final List<Candidate> result = new ArrayList<>();
        for (final List<BattleDelta> c : clusters) {
            for (final List<BattleDelta> piece : splitLongCluster(c)) {
                result.add(buildCandidate(timeline, all, piece));
            }
        }
        return result;
    }

    /** 该时刻是否已被某个死亡候选的填充范围覆盖（填充窗口内的伴随信号随死亡窗口一起输出）。 */
    private static boolean coveredByDeathWindow(final double timeSec, final List<Candidate> deathCandidates) {
        for (final Candidate c : deathCandidates) {
            if (timeSec >= c.coreStartSec - PADDING_SEC && timeSec <= c.coreEndSec + PADDING_SEC) {
                return true;
            }
        }
        return false;
    }

    private static boolean significantNonDeath(final BattleDelta d) {
        return switch (d.kind()) {
            case FIRST_CONTACT, ALIVE_COUNT_CHANGE, HP_GAP_DELTA, POINTS_CHANGE,
                    ENGAGEMENT_ACTIVITY, LOCAL_FORCE_CHANGE, HP_CHANGE -> true;
            default -> false;
        };
    }

    /** 以 cluster 为核心（含前后填充），收集窗口内全部有信息量的 delta 形成候选。 */
    private static Candidate buildCandidate(
            final BattleTimeline timeline,
            final List<BattleDelta> all,
            final List<BattleDelta> cluster) {
        final double coreStart = cluster.getFirst().timeSec();
        final double coreEnd = cluster.getLast().timeSec();
        double start = coreStart;
        double end = coreEnd;
        final List<BattleDelta> events = new ArrayList<>();
        for (final BattleDelta d : all) {
            if (d.timeSec() >= coreStart - PADDING_SEC && d.timeSec() <= coreEnd + PADDING_SEC
                    && informative(timeline, d)) {
                events.add(d);
                start = Math.min(start, d.timeSec());
                end = Math.max(end, d.timeSec());
            }
        }
        events.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                .thenComparing(d -> d.kind().name()));
        return new Candidate(coreStart, coreEnd, start, end, events,
                friendlyDeaths(timeline, events), enemyDeaths(timeline, events),
                hpSwing(events), engagementDamage(events),
                hasKind(events, DeltaKind.POINTS_CHANGE),
                hasKind(events, DeltaKind.FIRST_CONTACT),
                (int) events.stream().filter(d -> d.kind() == DeltaKind.ALIVE_COUNT_CHANGE).count());
    }

    /** 递归拆分跨度超限的簇：在最大相邻间隔处一分为二，直到每段 ≤ MAX_CLUSTER_SPAN_SEC。 */
    static List<List<BattleDelta>> splitLongCluster(final List<BattleDelta> cluster) {
        if (cluster.size() < 2) {
            return List.of(cluster);
        }
        final double span = cluster.getLast().timeSec() - cluster.getFirst().timeSec();
        if (span <= MAX_CLUSTER_SPAN_SEC) {
            return List.of(cluster);
        }
        int splitAt = -1;
        double maxGap = -1;
        for (int i = 1; i < cluster.size(); i++) {
            final double gap = cluster.get(i).timeSec() - cluster.get(i - 1).timeSec();
            if (gap > maxGap) {
                maxGap = gap;
                splitAt = i;
            }
        }
        if (splitAt <= 0) {
            return List.of(cluster);
        }
        final List<List<BattleDelta>> out = new ArrayList<>();
        out.addAll(splitLongCluster(cluster.subList(0, splitAt)));
        out.addAll(splitLongCluster(cluster.subList(splitAt, cluster.size())));
        return out;
    }

    /** 仅合并核心重叠的候选（同一次减员/同一簇信号的重复候选），填充重叠不算合并。 */
    private static List<Candidate> mergeOverlapping(
            final BattleTimeline timeline, final List<Candidate> candidates) {
        final List<Candidate> sorted = new ArrayList<>(candidates);
        sorted.sort(Comparator.comparingDouble((Candidate c) -> c.coreStartSec)
                .thenComparingDouble(c -> c.coreEndSec));
        final List<Candidate> out = new ArrayList<>();
        for (final Candidate c : sorted) {
            if (out.isEmpty()) {
                out.add(c);
                continue;
            }
            final Candidate prev = out.get(out.size() - 1);
            if (c.coreStartSec <= prev.coreEndSec + 1.0) {
                final List<BattleDelta> mergedEvents = new ArrayList<>(prev.events);
                for (final BattleDelta d : c.events) {
                    if (mergedEvents.stream().noneMatch(x -> sameDelta(x, d))) {
                        mergedEvents.add(d);
                    }
                }
                mergedEvents.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                        .thenComparing(x -> x.kind().name()));
                final double coreStart = Math.min(prev.coreStartSec, c.coreStartSec);
                final double coreEnd = Math.max(prev.coreEndSec, c.coreEndSec);
                final double start = Math.min(prev.startSec, c.startSec);
                final double end = Math.max(prev.endSec, c.endSec);
                out.set(out.size() - 1, new Candidate(
                        coreStart, coreEnd, start, end, mergedEvents,
                        friendlyDeaths(timeline, mergedEvents), enemyDeaths(timeline, mergedEvents),
                        hpSwing(mergedEvents), engagementDamage(mergedEvents),
                        hasKind(mergedEvents, DeltaKind.POINTS_CHANGE),
                        hasKind(mergedEvents, DeltaKind.FIRST_CONTACT),
                        (int) mergedEvents.stream()
                                .filter(d -> d.kind() == DeltaKind.ALIVE_COUNT_CHANGE).count()));
            } else {
                out.add(c);
            }
        }
        return out;
    }

    private static boolean sameDelta(final BattleDelta a, final BattleDelta b) {
        return a.kind() == b.kind()
                && Math.abs(a.timeSec() - b.timeSec()) < 1e-6
                && Objects.equals(a.entityId(), b.entityId());
    }

    // ===== 聚合（全部来自事件列表，确定性） =====

    private static int friendlyDeaths(final BattleTimeline timeline, final List<BattleDelta> events) {
        return (int) events.stream()
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .filter(d -> isFriendly(timeline, d))
                .count();
    }

    private static int enemyDeaths(final BattleTimeline timeline, final List<BattleDelta> events) {
        return (int) events.stream()
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .filter(d -> !isFriendly(timeline, d))
                .count();
    }

    private static double hpSwing(final List<BattleDelta> events) {
        return events.stream()
                .filter(d -> d.kind() == DeltaKind.HP_CHANGE || d.kind() == DeltaKind.HP_GAP_DELTA)
                .mapToDouble(d -> Math.abs(d.number("hpDelta", 0)))
                .sum();
    }

    private static int engagementDamage(final List<BattleDelta> events) {
        return events.stream()
                .filter(d -> d.kind() == DeltaKind.ENGAGEMENT_ACTIVITY)
                .mapToInt(d -> (int) d.number("damageInWindow", 0))
                .sum();
    }

    private static boolean hasKind(final List<BattleDelta> events, final DeltaKind kind) {
        return events.stream().anyMatch(d -> d.kind() == kind);
    }

    // ===== 打分 / 过滤 / 输出 =====

    /** 信息分：阵亡权重最高，其次 HP swing / 交火 / 点数 / 首次接敌。 */
    static double score(final Candidate c) {
        double s = c.friendlyDeaths * 1000.0 + c.enemyDeaths * 800.0;
        s += Math.min(c.hpSwing / 50.0, 500.0);
        s += Math.min(c.engagementDamage / 200.0, 300.0);
        s += c.pointsChanged ? 60.0 : 0.0;
        s += c.firstContact ? 40.0 : 0.0;
        s += c.aliveChanges * 30.0;
        return s;
    }

    private static boolean hasSignal(final Candidate c) {
        if (c.friendlyDeaths > 0 || c.enemyDeaths > 0) {
            return true;
        }
        return score(c) >= MIN_CANDIDATE_SCORE;
    }

    private static FocusWindow toWindow(final BattleTimeline timeline, final Candidate c) {
        final int maxSecond = Math.max(0, timeline.frames().size() - 1);
        final int beforeSecond = Math.max(0, (int) Math.floor(c.startSec) - 1);
        final int afterSecond = Math.min(maxSecond, (int) Math.floor(c.endSec));
        final WorldSummary before = frameWorld(timeline, beforeSecond);
        final WorldSummary after = frameWorld(timeline, afterSecond);
        final List<String> reasons = new ArrayList<>();
        if (c.friendlyDeaths > 0 || c.enemyDeaths > 0) {
            reasons.add("连续减员 " + c.friendlyDeaths + "v" + c.enemyDeaths);
        }
        if (c.hpSwing > 0) {
            reasons.add("HP 变化约 " + Math.round(c.hpSwing));
        }
        if (c.engagementDamage > 0) {
            reasons.add("交火活动");
        }
        if (c.pointsChanged) {
            reasons.add("点数变化");
        }
        if (c.firstContact) {
            reasons.add("首次接敌");
        }
        if (c.aliveChanges > 0) {
            reasons.add("存活人数变化");
        }
        return new FocusWindow(
                c.startSec,
                c.endSec,
                before,
                after,
                c.events,
                c.friendlyDeaths,
                c.enemyDeaths,
                c.hpSwing > 0,
                c.hpSwing,
                c.engagementDamage > 0,
                c.engagementDamage,
                c.pointsChanged,
                c.firstContact,
                reasons);
    }

    private static WorldSummary frameWorld(final BattleTimeline timeline, final int second) {
        final BattleFrame frame = timeline.frameAt(second);
        return frame == null ? WorldSummary.EMPTY : frame.world();
    }

    /** DESTROYED delta 的 side：按当时帧车辆 friendly 标志解析（不依赖文本猜测）。 */
    static boolean isFriendly(final BattleTimeline timeline, final BattleDelta d) {
        if (d.entityId() == null || timeline == null) {
            return false;
        }
        final BattleFrame frame = timeline.frameAt(Math.min(d.timeSec(), timeline.durationSec()));
        if (frame == null || frame.vehicles() == null) {
            return false;
        }
        return frame.vehicles().stream()
                .anyMatch(v -> v.entityId() == d.entityId() && v.friendly());
    }

    /** delta 是否作为事件行进入窗口（有信息量的变化 + 关键活动）。 */
    private static boolean informative(final BattleTimeline timeline, final BattleDelta d) {
        if (d.kind() == DeltaKind.DESTROYED || significantNonDeath(d)) {
            return true;
        }
        return d.kind() == DeltaKind.REGION_CHANGE || d.kind() == DeltaKind.POSITION_CHANGE;
    }

    private static boolean overlaps(final double aStart, final double aEnd,
                                    final double bStart, final double bEnd) {
        return aStart <= bEnd && bStart <= aEnd;
    }
}