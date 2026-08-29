package com.wotb.core.replay.timeline;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 团队复盘 Focus Window 选择器（确定性、小型，docs/current-plan.md §4/§5）。
 * <p>从 canonical {@link BattleTimeline} 的 delta 流中选出 1–3 个<b>信息密度最高</b>的
 * 决策窗口（Team Review Focus Window），供团队复盘 Prompt 注入 BEFORE/EVENTS/AFTER。
 * 与 {@link EpisodeDetector} 的差异：Episode 覆盖整场、连续、无重叠；Focus Window 是
 * 分析局部战术问题的观察窗口，只选信息密度最高的一段，允许跨 Episode。</p>
 * <p><b>识别目标</b>：短时间连续减员（如 1分52秒–2分12秒 内本方 3 死对方 1 死）必须
 * 成为最高优先窗口；无阵亡时仍能通过 HP swing / 点数变化 / 首次接敌 / 交火活动选出
 * 有意义的窗口。只输出 canonical facts，绝不编造战术原因。</p>
 * <p><b>CORE WINDOW 契约（PR #103 B2）</b>：窗口即核心区间（CORE WINDOW），
 * <b>不应用 padding</b>——friendlyDeaths / enemyDeaths / BEFORE / AFTER / OBSERVED FACTS /
 * startSec / endSec 全部基于核心区间内的 canonical delta 与帧状态，窗口外的阵亡
 * （如紧跟核心窗口末尾的对方第 2 次阵亡）不得污染核心事实；窗口外的上下文由
 * TACTICAL TIMELINE Episode 提供。</p>
 * <p><b>识别算法</b>：从阵亡事件做 bounded sliding window——对每个阵亡时刻向后扩展，
 * 只要 {@code end - start <= WINDOW_SEC}；每个有界区间是一个候选 core，其阵亡组成
 * 固定为该区间内的阵亡（绝不链式吞并区间外阵亡）。无阵亡时用非死亡高信息簇兜底。</p>
 * <p><b>约束</b>：窗口 events 只含窗口时间范围内的 delta；BEFORE/AFTER 取对应秒的
 * knowledge-world 状态（timeline 已满足 anti-future-leak）；不重复 delta、不 future leak。
 * 不构建第二套战场事实模型，全部消费已验证 timeline。</p>
 */
public final class TimelineFocusWindowSelector {

    /** 输出窗口上限（1–3）。 */
    public static final int MAX_WINDOWS = 3;
    /** 有界核心窗口最大跨度（秒）：阵亡窗口只接受总跨度 ≤ 该值的子区间（业务/算法窗口）。 */
    public static final double WINDOW_SEC = 20.0;
    /** 非死亡簇的最小信息分（低于则不出现在输出中；单独一次首次接敌不算关键窗口）。 */
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

        // 候选窗口 = 有界阵亡子窗口（core 信号）∪ 阵亡窗口之外的非死亡高信息簇
        final List<Candidate> candidates = new ArrayList<>();
        candidates.addAll(deathWindows(timeline, all));
        candidates.addAll(nonDeathClusters(timeline, all, candidates));

        // 有界阵亡窗口语义下，重叠候选是不同核心窗口（不同阵亡组成），不得合并；
        // 去重由下方 top-3 非重叠选择完成。
        final List<Candidate> ranked = candidates.stream()
                .filter(TimelineFocusWindowSelector::hasSignal)
                .sorted(Comparator
                        .comparingDouble((Candidate c) -> score(c))
                        .reversed()
                        .thenComparingDouble(c -> c.startSec))
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

    /**
     * 有界阵亡子窗口（bounded sliding window）：对每个阵亡时刻向后扩展，
     * 只要 {@code end - start <= WINDOW_SEC}；每个有界区间的阵亡组成固定为该区间内的阵亡。
     * 例如阵亡序列 112F/121F/128E/132F/136E：
     * <ul>
     *   <li>从 112 扩展：112/121/128/132（136 超界）→ core [112,132]：本方 3 死、对方 1 死；</li>
     *   <li>从 121 扩展：121/128/132/136 → core [121,136]：本方 2 死、对方 2 死；</li>
     *   <li>136s 的对方阵亡只出现在以 121/128/132/136 为起点的候选，不会改变 [112,132] 的 3:1 core。</li>
     * </ul>
     */
    private static List<Candidate> deathWindows(final BattleTimeline timeline, final List<BattleDelta> all) {
        final List<BattleDelta> deaths = all.stream()
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .toList();
        final List<Candidate> out = new ArrayList<>();
        for (int startIndex = 0; startIndex < deaths.size(); startIndex++) {
            final double start = deaths.get(startIndex).timeSec();
            int endIndex = startIndex;
            while (endIndex + 1 < deaths.size()
                    && deaths.get(endIndex + 1).timeSec() - start <= WINDOW_SEC + 1e-9) {
                endIndex++;
            }
            final List<BattleDelta> coreDeaths = deaths.subList(startIndex, endIndex + 1);
            if (coreDeaths.size() < 2) {
                continue; // 单阵亡不成「窗口」；散落单阵亡由非死亡信号或其它候选体现
            }
            out.add(buildCandidate(timeline, all, coreDeaths));
        }
        return out;
    }

    /**
     * 非死亡高信息簇：只取<b>未被阵亡窗口覆盖</b>的显著非死亡 delta（HP/点数/接敌/交火/存活变化），
     * 避免与阵亡窗口重复；按 ≤ WINDOW_SEC 间隔合并，保证「正常交火 + 点数/HP swing」也能选出窗口。
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
            if (cluster == null || d.timeSec() - lastTime > WINDOW_SEC) {
                cluster = new ArrayList<>();
                clusters.add(cluster);
            }
            cluster.add(d);
            lastTime = d.timeSec();
        }
        final List<Candidate> result = new ArrayList<>();
        for (final List<BattleDelta> c : clusters) {
            if (c.size() < 2) {
                continue;
            }
            result.add(buildCandidate(timeline, all, c));
        }
        return result;
    }

    /** 该时刻是否已被某个阵亡候选的核心区间覆盖（核心区间内的伴随信号随阵亡窗口一起输出）。 */
    private static boolean coveredByDeathWindow(final double timeSec, final List<Candidate> deathCandidates) {
        for (final Candidate c : deathCandidates) {
            if (timeSec >= c.startSec && timeSec <= c.endSec) {
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

    /** 以 core（cluster 覆盖区间）为窗口：events 只含 [coreStart, coreEnd] 内的有信息量 delta。 */
    private static Candidate buildCandidate(
            final BattleTimeline timeline,
            final List<BattleDelta> all,
            final List<BattleDelta> cluster) {
        final double start = cluster.getFirst().timeSec();
        final double end = cluster.getLast().timeSec();
        final List<BattleDelta> events = new ArrayList<>();
        for (final BattleDelta d : all) {
            if (d.timeSec() >= start - 1e-9 && d.timeSec() <= end + 1e-9
                    && informative(timeline, d)) {
                events.add(d);
            }
        }
        events.sort(Comparator.comparingDouble(BattleDelta::timeSec)
                .thenComparing(d -> d.kind().name()));
        return new Candidate(start, end, events,
                friendlyDeaths(timeline, events), enemyDeaths(timeline, events),
                hpSwing(events), engagementDamage(events),
                hasKind(events, DeltaKind.POINTS_CHANGE),
                hasKind(events, DeltaKind.FIRST_CONTACT),
                (int) events.stream().filter(d -> d.kind() == DeltaKind.ALIVE_COUNT_CHANGE).count());
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

    /**
     * 信息分：绝对局势 swing（交换不对称）优先于总死亡密度——friendly/enemy 死亡都计入
     * 「事件重要度」，但双方死亡差（|fd−ed|）是「局势 swing」主权重；balanced massacre
     * 不会仅因总死亡数高而轻易压过明显单边 collapse/sweep。HP swing / 交火 / 点数 /
     * 首次接敌 / 存活变化作为支撑信号。
     */
    static double score(final Candidate c) {
        final int totalDeaths = c.friendlyDeaths + c.enemyDeaths;
        final int swing = Math.abs(c.friendlyDeaths - c.enemyDeaths);
        double s = swing * 800.0 + totalDeaths * 200.0;
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