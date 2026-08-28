package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.FramePosition;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.replay.timeline.TimelineFocusWindowSelector;
import com.wotb.core.replay.timeline.WorldSummary;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Team Review Grounding Facts（确定性，Backend 唯一事实源投影，docs/features/team-ai-review.md
 * Natural Coach 轮 §9/§10/§11）。
 * <p>从权威结算 + 已验证 canonical {@link BattleTimeline} 提取<b>带稳定证据编号</b>的
 * 事实清单，供：① 输入 prompt（渲染 GROUNDING FACTS 段，LLM 在 structured claims 中引用
 * 证据编号）；② {@link TeamFactualConsistencyValidator} 做事实一致性校验。</p>
 * <p>事实类型：PLAYER_DESTROYED（阵亡）/ ALIVE_COUNT_TRANSITION（存活变化）/
 * FOCUS_WINDOW（关注窗口）/ POSITION_REGION（位置区域快照）/
 * ENEMY_POSITION_KNOWN（敌方位置知识 CURRENT / LAST_KNOWN）。</p>
 * <p>边界：只输出确定性事实与确定性派生测量，不做战术裁决；timeline 为 null（兼容入口）
 * 时只输出结算可推导事实（阵亡/存活变化），位置/窗口类事实缺失（对应 validator 检查自动
 * no-op）。</p>
 */
public final class TeamGroundingFacts {

    public static final String TYPE_PLAYER_DESTROYED = "PLAYER_DESTROYED";
    public static final String TYPE_ALIVE_TRANSITION = "ALIVE_COUNT_TRANSITION";
    public static final String TYPE_FOCUS_WINDOW = "FOCUS_WINDOW";
    public static final String TYPE_POSITION_REGION = "POSITION_REGION";
    public static final String TYPE_ENEMY_POSITION = "ENEMY_POSITION_KNOWN";

    private static final double TIME_TOLERANCE_SEC = 1.0;

    private TeamGroundingFacts() {
    }

    // ===== records =====

    public enum Side { FRIENDLY, ENEMY }

    /** 一条带稳定证据编号的确定性事实（attrs 为机器可读附加字段）。 */
    public record EvidenceFact(
            String id,
            String type,
            Side side,
            double startSec,
            double endSec,
            Long accountId,
            String nickname,
            String tankName,
            Map<String, String> attrs
    ) {
        /** 事件代表时刻（deathSec / 变化时刻 / 窗口结束）；无事件时刻返回 startSec。 */
        public double timeSec() {
            return endSec >= 0 ? endSec : startSec;
        }

        public boolean isDeath() {
            return TYPE_PLAYER_DESTROYED.equals(type);
        }
    }

    /** 存活数变化（before → after，sec 为变化时刻，battle-relative）。 */
    public record AliveTransition(
            double sec,
            int beforeFriendly,
            int beforeEnemy,
            int afterFriendly,
            int afterEnemy
    ) {
    }

    /** 位置区域快照：某秒双方存活车辆按九宫格 region 的车辆数（friendly 为 CURRENT 位置）。 */
    public record RegionSnapshot(
            double sec,
            Map<String, Integer> friendlyCounts,
            Map<String, Integer> enemyCurrentCounts
    ) {
    }

    /** 敌方位置知识样本：某秒某敌方车辆的 resolved 位置（CURRENT / LAST_KNOWN）。 */
    public record EnemyPositionSample(
            double sec,
            Long accountId,
            String nickname,
            String tankName,
            String region,
            String knowledge,
            Double observedAtSec,
            Double ageSec
    ) {
    }

    /** Grounding 事实全集（facts 为按 id 升序的稳定清单；byId 为检索索引）。 */
    public record GroundingFacts(
            List<EvidenceFact> facts,
            Map<String, EvidenceFact> byId,
            List<AliveTransition> aliveTransitions,
            List<RegionSnapshot> regionSnapshots,
            List<EnemyPositionSample> enemyPositions
    ) {
        public GroundingFacts {
            facts = facts == null ? List.of() : List.copyOf(facts);
            aliveTransitions = aliveTransitions == null ? List.of() : List.copyOf(aliveTransitions);
            regionSnapshots = regionSnapshots == null ? List.of() : List.copyOf(regionSnapshots);
            enemyPositions = enemyPositions == null ? List.of() : List.copyOf(enemyPositions);
            final Map<String, EvidenceFact> index = new LinkedHashMap<>();
            for (final EvidenceFact f : facts) {
                index.put(f.id(), f);
            }
            byId = Map.copyOf(index);
        }
    }

    // ===== build =====

    /**
     * 构建 Grounding Facts（production 路径：timeline 提供 battle start raw clock）。
     *
     * @param battle          权威结算（必选；阵亡/存活变化来源）
     * @param timeline        已验证 canonical timeline（可为 null：兼容入口只给结算级事实）
     * @param perspectiveTeam 视角队伍（TEAM_A/1 或 TEAM_B/2）
     */
    public static GroundingFacts build(final Battle battle,
                                       final BattleTimeline timeline,
                                       final int perspectiveTeam) {
        return buildInternal(battle, timeline,
                timeline == null ? null : timeline.battleStartRawClockSec(),
                perspectiveTeam);
    }

    /**
     * 构建 Grounding Facts（compat 入口：无已验证 timeline）。
     * <p><b>死亡时刻时钟契约（Review B2-1）</b>：{@code PlayerResultFormat.deathSec()} 的
     * 数值域不统一——{@code deathTimeMillis}（结算权威）与 legacy 估算都是<b>原始时钟域</b>，
     * 而 {@code DeathTimeReconciler} 校准的 {@code survivalTimeSec} 是 <b>battle-relative</b>。
     * 本方法统一按 {@code raw > startRaw → raw − startRaw} 转 battle-relative（与
     * {@code TeamReviewRealReplayProbeTest} 同口径）：compat 入口必须传入
     * {@code reconstruction.battleStartRawClockSec()}（可为 null：原始时钟缺失时按
     * battle-relative 原样使用），否则结算死亡时刻会以原始时钟值进入 Grounding Facts，
     * V2 校验与 claim 的 battle-relative timeSec 对不上。</p>
     *
     * @param battle                  权威结算（必选；阵亡/存活变化来源）
     * @param battleStartRawClockSec  battle start 原始时钟（可为 null：按 battle-relative 原样）
     * @param perspectiveTeam         视角队伍（TEAM_A/1 或 TEAM_B/2）
     */
    public static GroundingFacts build(final Battle battle,
                                       final Double battleStartRawClockSec,
                                       final int perspectiveTeam) {
        return buildInternal(battle, null, battleStartRawClockSec, perspectiveTeam);
    }

    /** 内部构建（shared）：production（timeline 非 null）与 compat（timeline null + 显式 startRaw）。 */
    private static GroundingFacts buildInternal(final Battle battle,
                                                final BattleTimeline timeline,
                                                final Double battleStartRawClockSec,
                                                final int perspectiveTeam) {
        final List<EvidenceFact> facts = new ArrayList<>();
        final List<AliveTransition> transitions = new ArrayList<>();
        final List<RegionSnapshot> snapshots = new ArrayList<>();
        final List<EnemyPositionSample> enemyPositions = new ArrayList<>();
        final double startRaw = battleStartRawClockSec == null
                ? Double.NaN : battleStartRawClockSec;

        // 1) 阵亡（PLAYER_DESTROYED）：权威结算死亡时刻 → battle-relative
        final List<PlayerResult> players = battle == null || battle.players == null
                ? List.of() : battle.players;
        final List<PlayerResult> dead = players.stream()
                .filter(p -> p != null && !p.survived && PlayerResultFormat.deathSec(p) > 0)
                .sorted(Comparator.comparingDouble(PlayerResultFormat::deathSec))
                .toList();
        for (final PlayerResult p : dead) {
            final double rel = battleRelative(p, startRaw);
            facts.add(new EvidenceFact(
                    null, TYPE_PLAYER_DESTROYED,
                    p.team == perspectiveTeam ? Side.FRIENDLY : Side.ENEMY,
                    rel, rel, p.accountId, p.nickname, p.tankName, Map.of()));
        }

        // 2) 存活变化（ALIVE_COUNT_TRANSITION）：timeline 帧 WorldSummary 优先，否则由阵亡推导
        if (timeline != null && timeline.frames() != null && !timeline.frames().isEmpty()) {
            WorldSummary prev = null;
            for (final BattleFrame frame : timeline.frames()) {
                final WorldSummary cur = frame.world();
                if (prev != null && prev != cur
                        && (prev.friendlyAlive() != cur.friendlyAlive()
                        || prev.enemyAlive() != cur.enemyAlive())) {
                    transitions.add(new AliveTransition(frame.stateAtSec(),
                            prev.friendlyAlive(), prev.enemyAlive(),
                            cur.friendlyAlive(), cur.enemyAlive()));
                }
                prev = cur;
            }
        } else {
            final int friendlyTotal = (int) players.stream()
                    .filter(p -> p != null && p.team == perspectiveTeam).count();
            final int enemyTotal = (int) players.stream()
                    .filter(p -> p != null && p.team != perspectiveTeam).count();
            int fAlive = friendlyTotal;
            int eAlive = enemyTotal;
            for (final PlayerResult p : dead) {
                final double rel = battleRelative(p, startRaw);
                final int beforeF = fAlive;
                final int beforeE = eAlive;
                if (p.team == perspectiveTeam) {
                    fAlive--;
                } else {
                    eAlive--;
                }
                transitions.add(new AliveTransition(rel, beforeF, beforeE, fAlive, eAlive));
            }
        }

        // 3) 关注窗口（FOCUS_WINDOW）：确定性 selector，timeline 必需
        if (timeline != null) {
            final List<TimelineFocusWindowSelector.FocusWindow> windows =
                    TimelineFocusWindowSelector.select(timeline);
            for (final TimelineFocusWindowSelector.FocusWindow w : windows) {
                final Map<String, String> attrs = new LinkedHashMap<>();
                attrs.put("friendlyDeaths", String.valueOf(w.friendlyDeaths()));
                attrs.put("enemyDeaths", String.valueOf(w.enemyDeaths()));
                attrs.put("beforeFriendly", String.valueOf(w.before().friendlyAlive()));
                attrs.put("beforeEnemy", String.valueOf(w.before().enemyAlive()));
                attrs.put("afterFriendly", String.valueOf(w.after().friendlyAlive()));
                attrs.put("afterEnemy", String.valueOf(w.after().enemyAlive()));
                facts.add(new EvidenceFact(null, TYPE_FOCUS_WINDOW, Side.FRIENDLY,
                        w.startSec(), w.endSec(), null, null, null, attrs));
            }
        }

        // 4) 位置区域快照 + 敌方位置知识样本（timeline 必需；锚点秒数确定性计算）
        if (timeline != null) {
            final List<Double> anchors = anchors(timeline);
            for (final double anchorSec : anchors) {
                final BattleFrame frame = timeline.frameAt(anchorSec);
                if (frame == null || frame.vehicles() == null) {
                    continue;
                }
                final Map<String, Integer> friendly = new LinkedHashMap<>();
                final Map<String, Integer> enemyCurrent = new LinkedHashMap<>();
                for (final FrameVehicle v : frame.vehicles()) {
                    if (v.mapState() == null || v.mapState().gridRegion() == null) {
                        continue;
                    }
                    final String region = String.valueOf(v.mapState().gridRegion());
                    if (v.friendly()) {
                        friendly.merge(region, 1, Integer::sum);
                    } else if (v.position() != null
                            && v.position().knowledge() == PositionKnowledge.CURRENT) {
                        enemyCurrent.merge(region, 1, Integer::sum);
                    }
                }
                final Map<String, Integer> friendlyCopy = Map.copyOf(friendly);
                final Map<String, Integer> enemyCurrentCopy = Map.copyOf(enemyCurrent);
                snapshots.add(new RegionSnapshot(anchorSec, friendlyCopy, enemyCurrentCopy));
                final Map<String, String> attrs = new LinkedHashMap<>();
                attrs.put("friendly", regionCountsText(friendlyCopy));
                attrs.put("enemyCurrent", regionCountsText(enemyCurrentCopy));
                facts.add(new EvidenceFact(null, TYPE_POSITION_REGION, Side.FRIENDLY,
                        anchorSec, anchorSec, null, null, null, attrs));
                // 敌方位置知识样本（resolved 位置才输出：CURRENT / LAST_KNOWN，UNKNOWN 静默）
                for (final FrameVehicle v : frame.vehicles()) {
                    if (v.friendly() || v.mapState() == null || v.mapState().gridRegion() == null
                            || v.position() == null) {
                        continue;
                    }
                    final PositionKnowledge k = v.position().knowledge();
                    if (k == PositionKnowledge.UNKNOWN) {
                        continue;
                    }
                    final double observedAt = v.position().positionObservedAtSec() == null
                            ? Double.NaN : v.position().positionObservedAtSec();
                    final double age = v.position().positionAgeSec() == null
                            ? Double.NaN : v.position().positionAgeSec();
                    enemyPositions.add(new EnemyPositionSample(
                            anchorSec, v.accountId(), v.nickname(), v.tankName(),
                            String.valueOf(v.mapState().gridRegion()), k.name(),
                            Double.isFinite(observedAt) ? observedAt : null,
                            Double.isFinite(age) ? age : null));
                }
            }
        }

        // 5) 稳定证据编号：确定性顺序（阵亡→存活变化→窗口→快照→敌方位置）
        int counter = 101;
        final List<EvidenceFact> ordered = new ArrayList<>();
        // 阵亡（按时间）
        final List<EvidenceFact> deaths = facts.stream()
                .filter(EvidenceFact::isDeath)
                .sorted(Comparator.comparingDouble(EvidenceFact::timeSec)
                        .thenComparing(f -> f.nickname() == null ? "" : f.nickname()))
                .toList();
        for (final EvidenceFact f : deaths) {
            ordered.add(withId(f, counter++));
        }
        // 存活变化（按时间）
        transitions.sort(Comparator.comparingDouble(AliveTransition::sec));
        for (final AliveTransition t : transitions) {
            final Map<String, String> attrs = new LinkedHashMap<>();
            attrs.put("before", t.beforeFriendly() + "v" + t.beforeEnemy());
            attrs.put("after", t.afterFriendly() + "v" + t.afterEnemy());
            ordered.add(new EvidenceFact("E" + counter++, TYPE_ALIVE_TRANSITION, Side.FRIENDLY,
                    t.sec(), t.sec(), null, null, null, attrs));
        }
        // 关注窗口（按开始时间）
        final List<EvidenceFact> windows = facts.stream()
                .filter(f -> TYPE_FOCUS_WINDOW.equals(f.type()))
                .sorted(Comparator.comparingDouble(EvidenceFact::startSec))
                .toList();
        for (final EvidenceFact f : windows) {
            ordered.add(withId(f, counter++));
        }
        // 位置快照（按时间）
        snapshots.sort(Comparator.comparingDouble(RegionSnapshot::sec));
        for (final RegionSnapshot s : snapshots) {
            final EvidenceFact f = facts.stream()
                    .filter(x -> TYPE_POSITION_REGION.equals(x.type())
                            && Math.abs(x.startSec() - s.sec()) < TIME_TOLERANCE_SEC)
                    .findFirst().orElse(null);
            if (f != null) {
                ordered.add(withId(f, counter++));
            }
        }
        // 敌方位置知识（按时间，再按昵称）
        enemyPositions.sort(Comparator.comparingDouble(EnemyPositionSample::sec)
                .thenComparing(s -> s.nickname() == null ? "" : s.nickname()));
        for (final EnemyPositionSample s : enemyPositions) {
            final Map<String, String> attrs = new LinkedHashMap<>();
            attrs.put("region", s.region());
            attrs.put("knowledge", s.knowledge());
            attrs.put("observedAtSec", s.observedAtSec() == null ? "" : formatNum(s.observedAtSec()));
            attrs.put("ageSec", s.ageSec() == null ? "" : formatNum(s.ageSec()));
            ordered.add(new EvidenceFact("E" + counter++, TYPE_ENEMY_POSITION, Side.ENEMY,
                    s.sec(), s.sec(), s.accountId(), s.nickname(), s.tankName(), attrs));
        }

        return new GroundingFacts(ordered, Map.of(), transitions, snapshots, enemyPositions);
    }

    // ===== render（prompt 段）=====

    /** 渲染 GROUNDING FACTS 段（确定性；无事实时返回空串）。 */
    public static String renderGroundingSection(final GroundingFacts facts) {
        if (facts == null || facts.facts().isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== GROUNDING FACTS（确定性事实·每条含证据编号，供结构化输出引用；正文不得出现这些编号） ===\n");
        for (final EvidenceFact f : facts.facts()) {
            sb.append(f.id()).append(" ").append(renderFact(f)).append('\n');
        }
        return sb.toString();
    }

    private static String renderFact(final EvidenceFact f) {
        return switch (f.type()) {
            case TYPE_PLAYER_DESTROYED -> "["
                    + (f.side() == Side.FRIENDLY ? "本方阵亡" : "对方阵亡") + "] "
                    + formatClock(f.timeSec()) + " " + displayName(f) + "（" + displayTank(f) + "）"
                    + (f.accountId() == null ? "" : " acc=" + f.accountId());
            case TYPE_ALIVE_TRANSITION -> "[存活变化] "
                    + f.attrs().getOrDefault("before", "?") + " → "
                    + f.attrs().getOrDefault("after", "?") + "（" + formatClock(f.timeSec()) + " 前后）";
            case TYPE_FOCUS_WINDOW -> "[关注窗口] " + formatClock(f.startSec()) + "-" + formatClock(f.endSec())
                    + " 本方" + f.attrs().getOrDefault("friendlyDeaths", "0") + "死 对方"
                    + f.attrs().getOrDefault("enemyDeaths", "0") + "死";
            case TYPE_POSITION_REGION -> "[位置快照 @" + formatClock(f.timeSec()) + "] 本方 "
                    + f.attrs().getOrDefault("friendly", "无")
                    + (f.attrs().getOrDefault("enemyCurrent", "").isEmpty()
                            ? "" : "；对方当前 " + f.attrs().get("enemyCurrent"));
            case TYPE_ENEMY_POSITION -> "[敌方位置 @" + formatClock(f.timeSec()) + "] "
                    + displayTank(f) + " " + f.attrs().getOrDefault("knowledge", "UNKNOWN")
                    + " GRID" + f.attrs().getOrDefault("region", "?")
                    + (f.accountId() == null ? "" : " acc=" + f.accountId())
                    + ("LAST_KNOWN".equals(f.attrs().get("knowledge"))
                            ? "（上次观测 " + formatClockSafe(f.attrs().get("observedAtSec"))
                                    + "，age " + f.attrs().getOrDefault("ageSec", "?") + "秒）" : "");
            default -> f.type() + " @" + formatClock(f.timeSec());
        };
    }

    // ===== helpers =====

    private static EvidenceFact withId(final EvidenceFact f, final int id) {
        return new EvidenceFact("E" + id, f.type(), f.side(), f.startSec(), f.endSec(),
                f.accountId(), f.nickname(), f.tankName(), f.attrs());
    }

    private static String displayName(final EvidenceFact f) {
        return f.nickname() == null || f.nickname().isBlank() ? "未知玩家" : f.nickname();
    }

    private static String displayTank(final EvidenceFact f) {
        return f.tankName() == null || f.tankName().isBlank() ? "未知坦克" : f.tankName();
    }

    /** 结算死亡时刻 → battle-relative（与 TeamReviewRealReplayProbeTest 同口径）。 */
    private static double battleRelative(final PlayerResult p, final double startRaw) {
        final double raw = PlayerResultFormat.deathSec(p);
        if (Double.isFinite(startRaw) && raw > startRaw) {
            return raw - startRaw;
        }
        return raw;
    }

    /** 位置区域锚点秒数（确定性）：开局 + 关注窗口边界 + 中段 + 结尾，去重、钳制、限量。 */
    private static List<Double> anchors(final BattleTimeline timeline) {
        final Set<Double> set = new LinkedHashSet<>();
        final double maxSec = Math.max(0.0, timeline.durationSec() - 1.0);
        // 开局锚点（约 30s，短局用半程）
        set.add(Math.min(30.0, maxSec));
        // 关注窗口边界（最多取前 2 个窗口）
        final List<TimelineFocusWindowSelector.FocusWindow> windows =
                TimelineFocusWindowSelector.select(timeline);
        final List<TimelineFocusWindowSelector.FocusWindow> top = windows.stream()
                .limit(2).toList();
        for (final TimelineFocusWindowSelector.FocusWindow w : top) {
            set.add(clamp(w.startSec() - 1.0, 0.0, maxSec));
            set.add(clamp((w.startSec() + w.endSec()) / 2.0, 0.0, maxSec));
            set.add(clamp(w.endSec() + 1.0, 0.0, maxSec));
        }
        // 结尾锚点
        set.add(maxSec);
        final List<Double> anchors = new ArrayList<>(set);
        anchors.sort(Double::compareTo);
        // 限量：保留开局/结尾 + 最高分窗口附近，最多 6 个
        if (anchors.size() <= 6) {
            return List.copyOf(anchors);
        }
        final Set<Double> keep = new LinkedHashSet<>();
        keep.add(anchors.get(0));
        keep.add(anchors.get(anchors.size() - 1));
        if (!top.isEmpty()) {
            final TimelineFocusWindowSelector.FocusWindow w = top.get(0);
            keep.add(clamp(w.startSec() - 1.0, 0.0, maxSec));
            keep.add(clamp((w.startSec() + w.endSec()) / 2.0, 0.0, maxSec));
            keep.add(clamp(w.endSec() + 1.0, 0.0, maxSec));
        }
        for (final double a : anchors) {
            if (keep.size() >= 6) {
                break;
            }
            keep.add(a);
        }
        return keep.stream().sorted().toList();
    }

    private static double clamp(final double v, final double min, final double max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String regionCountsText(final Map<String, Integer> counts) {
        if (counts.isEmpty()) {
            return "无";
        }
        final List<String> parts = counts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> "GRID" + e.getKey() + "=" + e.getValue())
                .toList();
        return String.join(" ", parts);
    }

    /** 秒 → "X分XX秒"（battle-relative，LLM 时间格式要求）。 */
    public static String formatClock(final double sec) {
        if (!Double.isFinite(sec) || sec < 0) {
            return "未知";
        }
        final int total = (int) Math.round(sec);
        final int m = total / 60;
        final int s = total % 60;
        return m + "分" + String.format(Locale.ROOT, "%02d", s) + "秒";
    }

    static String formatClockSafe(final String raw) {
        try {
            return formatClock(Double.parseDouble(raw));
        } catch (final NumberFormatException e) {
            return "未知";
        }
    }

    private static String formatNum(final double v) {
        return String.format(Locale.ROOT, "%.1f", v);
    }
}
