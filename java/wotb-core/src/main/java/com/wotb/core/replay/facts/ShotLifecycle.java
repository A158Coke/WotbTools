package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.ProjectileLaunchedEvent;
import com.wotb.core.replay.event.ProjectileTerminalEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ShotResultEvent;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 射击生命周期组装器。
 *
 * <p>从事件流组装 canonical {@link ShotFact}：method29 launch 为锚点，按 shotId 配对
 * method20/27；Type28/method17 在发射时刻取最近先前的状态（跨 arena/init 边界不继承——
 * 无状态即 UNKNOWN）。</p>
 *
 * <p><b>method38 ↔ recorder shot 配对（PR147）</b>：method38 是 recorder-local outgoing
 * result（docs/research/replay/avatar-shot-results.md），controlled Quby→Maus 证明 recorder
 * method29 launch 与 method38 在<b>同一 raw replay clock</b> 成对（30/30）。因此：
 * <ul>
 *   <li>仅 recorder 射击允许关联 method38（non-recorder method29 永不消费 recorder-local method38）；</li>
 *   <li>优先 <b>exact rawClock 分组 + sequence 顺序</b> 做 deterministic 配对——同刻多发射 /
 *       多 result 也能逐发准确关联，不再因 ±1s 窗口内多发射降成 UNKNOWN；</li>
 *   <li>exact 分组内 launch/result 计数相等 → 按 sequence 顺序一对一无遗漏；计数不等
 *       （ambiguity，如发射与 result 数量不一致）→ UNKNOWN，不猜测；</li>
 *   <li>仅当某发射 exact-clock 不可用（无同刻 result）时才允许<b>窄范围、严格唯一</b>的
 *       fallback；exact 已有但混淆的发射不进入 fallback；</li>
 *   <li>ambiguity 一律 UNKNOWN；一个 method38 result 只能被一个 shot 消费（consumed 标记）。</li>
 * </ul>
 */
public final class ShotLifecycle {

    /** method38 fallback 配对的最大时间窗（秒）；仅在 exact-clock 不可用时使用，且须严格唯一。 */
    static final double SHOT_RESULT_WINDOW_SEC = 1.0;

    private ShotLifecycle() {
    }

    /**
     * 组装全部射击事实。
     *
     * @param events             全部领域事件
     * @param mapping            entity→account 映射（可为 null）
     * @param recorderAccountId  录像者账号（可为 null）
     * @param startRawClockSec   battle start 原始时钟（可为 null → 退回 raw）
     */
    public static List<ShotFact> build(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final Long recorderAccountId,
            final Double startRawClockSec) {
        if (events == null) {
            return List.of();
        }
        final List<ReplayEvent> ordered = new ArrayList<>(events);
        ordered.sort(Comparator.comparingDouble((ReplayEvent e) -> clockOf(e, startRawClockSec))
                .thenComparingInt(ReplayEvent::sequence));

        final Map<Integer, ProjectileLaunchedEvent> launches = new HashMap<>();
        final Map<Integer, ProjectileTerminalEvent> terminals = new HashMap<>();
        final List<AmmunitionSelectionChangedEvent> selections = new ArrayList<>();
        final List<AmmunitionStateEvent> ammoStates = new ArrayList<>();
        final List<ShotResultEvent> results = new ArrayList<>();
        for (final ReplayEvent e : ordered) {
            switch (e) {
                case ProjectileLaunchedEvent p -> launches.put(p.shotId(), p);
                case ProjectileTerminalEvent t -> terminals.put(t.shotId(), t);
                case AmmunitionSelectionChangedEvent s -> selections.add(s);
                case AmmunitionStateEvent a -> ammoStates.add(a);
                case ShotResultEvent sr -> results.add(sr);
                default -> {
                    // 其它事件不影响射击生命周期
                }
            }
        }

        final List<Integer> recorderEntityIds = recorderAccountId != null && mapping != null
                ? mapping.entityIds(recorderAccountId) : List.of();
        final Map<Integer, ShotResolution> resolutionByShotId =
                pairRecorderResults(launches, results, recorderEntityIds);
        final List<ShotFact> facts = new ArrayList<>();
        for (final ProjectileLaunchedEvent launch : launches.values()) {
            final double t = clockOf(launch, startRawClockSec);
            final ProjectileTerminalEvent terminal = terminals.get(launch.shotId());
            final ShotResolution resolution = resolutionByShotId.get(launch.shotId());
            final Integer selection = latestSelection(selections, t, startRawClockSec);
            final Integer descriptor = latestDescriptor(ammoStates, t, startRawClockSec);
            final long shooterAccount = mapping != null
                    && mapping.identity(launch.shooterEntityId()) != null
                    ? mapping.identity(launch.shooterEntityId()).accountId() : 0L;
            facts.add(new ShotFact(
                    launch.shotId(),
                    launch.shooterEntityId(),
                    shooterAccount,
                    t,
                    launch.launchPosition(),
                    launch.launchVelocity(),
                    terminal == null ? null : clockOf(terminal, startRawClockSec),
                    terminal == null ? null : terminal.terminalPosition(),
                    selection,
                    descriptor,
                    resolution,
                    recorderEntityIds.contains(launch.shooterEntityId())));
        }
        facts.sort(Comparator.comparingDouble(ShotFact::launchTimeSec)
                .thenComparingInt(ShotFact::shotId));
        return List.copyOf(facts);
    }

    /**
     * method38（recorder-local outgoing result）↔ recorder method29 launch 的确定性配对。
     * 返回 shotId → resolution；无法确定（non-recorder / ambiguity / 无 result / 消费耗尽）→ 不出现。
     */
    private static Map<Integer, ShotResolution> pairRecorderResults(
            final Map<Integer, ProjectileLaunchedEvent> launches,
            final List<ShotResultEvent> results,
            final List<Integer> recorderEntityIds) {
        final Map<Integer, ShotResolution> out = new HashMap<>();
        if (results.isEmpty()) {
            return out;
        }
        final List<ProjectileLaunchedEvent> recorderLaunches = new ArrayList<>();
        for (final ProjectileLaunchedEvent l : launches.values()) {
            if (recorderEntityIds.contains(l.shooterEntityId())) {
                recorderLaunches.add(l);
            }
        }
        if (recorderLaunches.isEmpty()) {
            return out;
        }
        recorderLaunches.sort(Comparator.comparingDouble((ProjectileLaunchedEvent l) -> (double) rawClockOf(l))
                .thenComparingInt(ReplayEvent::sequence));
        final List<ShotResultEvent> orderedResults = new ArrayList<>(results);
        orderedResults.sort(Comparator.comparingDouble((ShotResultEvent r) -> (double) rawClockOf(r))
                .thenComparingInt(ReplayEvent::sequence));

        // raw replay clock 严格相同分组（exact protocol clock）
        final Map<Float, List<ProjectileLaunchedEvent>> recByClock = new HashMap<>();
        for (final ProjectileLaunchedEvent l : recorderLaunches) {
            if (Float.isFinite(rawClockOf(l))) {
                recByClock.computeIfAbsent(rawClockOf(l), k -> new ArrayList<>()).add(l);
            }
        }
        final Map<Float, List<Integer>> resIdxByClock = new HashMap<>();
        for (int i = 0; i < orderedResults.size(); i++) {
            final float rc = rawClockOf(orderedResults.get(i));
            if (Float.isFinite(rc)) {
                resIdxByClock.computeIfAbsent(rc, k -> new ArrayList<>()).add(i);
            }
        }
        final boolean[] consumed = new boolean[orderedResults.size()];

        // 1) exact-clock：同刻 launch/result 按 sequence 顺序一对一，仅在计数相等时（deterministic）
        for (final Map.Entry<Float, List<ProjectileLaunchedEvent>> e : recByClock.entrySet()) {
            final List<ProjectileLaunchedEvent> ls = e.getValue();
            final List<Integer> rs = resIdxByClock.get(e.getKey());
            if (rs == null || rs.isEmpty()) {
                continue; // 该发射无同刻 result → 留给 fallback
            }
            if (ls.size() == rs.size()) {
                for (int i = 0; i < ls.size(); i++) {
                    final int ridx = rs.get(i);
                    consumed[ridx] = true;
                    final ShotResultEvent r = orderedResults.get(ridx);
                    out.put(ls.get(i).shotId(), ShotResolution.of(
                            r.resultFlags16(), r.modifierIds(), r.components()));
                }
            }
            // 计数不等（ambiguity）→ 不配对、不消费，保持 UNKNOWN
        }

        // 2) fallback：仅对「无任何同刻 result」的发射，找窄窗口内「恰一个未消费」result（严格唯一）
        //    （exact 已有但混淆的发射不进入本 fallback）
        for (final ProjectileLaunchedEvent l : recorderLaunches) {
            if (out.containsKey(l.shotId())) {
                continue;
            }
            final float lClock = rawClockOf(l);
            if (resIdxByClock.containsKey(lClock)) {
                continue; // exact 已有同刻 result（但计数混淆）→ ambiguity，不改
            }
            final List<Integer> candidates = new ArrayList<>();
            for (int i = 0; i < orderedResults.size(); i++) {
                if (consumed[i] || !Float.isFinite(rawClockOf(orderedResults.get(i)))) {
                    continue;
                }
                if (Math.abs(rawClockOf(orderedResults.get(i)) - lClock) <= SHOT_RESULT_WINDOW_SEC) {
                    candidates.add(i);
                }
            }
            if (candidates.size() == 1) {
                final int ridx = candidates.getFirst();
                consumed[ridx] = true;
                final ShotResultEvent r = orderedResults.get(ridx);
                out.put(l.shotId(), ShotResolution.of(
                        r.resultFlags16(), r.modifierIds(), r.components()));
            }
            // 0 或 >1 → ambiguity → UNKNOWN
        }
        return out;
    }

    /** 发射时刻最近先前的 Type28 选择值；无 → null（UNKNOWN，跨 init 不继承）。 */
    private static Integer latestSelection(
            final List<AmmunitionSelectionChangedEvent> selections, final double launchTime,
            final Double startRawClockSec) {
        AmmunitionSelectionChangedEvent latest = null;
        for (final AmmunitionSelectionChangedEvent s : selections) {
            final double t = clockOf(s, startRawClockSec);
            if (!Double.isFinite(t)) {
                continue;
            }
            if (t <= launchTime + 1e-9) {
                latest = s;
            } else {
                break;
            }
        }
        return latest == null ? null : latest.selectionValue();
    }

    /** 发射时刻最近先前的 method17 descriptor；无 → null（UNKNOWN）。 */
    private static Integer latestDescriptor(
            final List<AmmunitionStateEvent> states, final double launchTime,
            final Double startRawClockSec) {
        AmmunitionStateEvent latest = null;
        for (final AmmunitionStateEvent a : states) {
            final double t = clockOf(a, startRawClockSec);
            if (!Double.isFinite(t)) {
                continue;
            }
            if (t <= launchTime + 1e-9) {
                latest = a;
            } else {
                break;
            }
        }
        return latest == null ? null : latest.itemDescriptorRaw();
    }

    /** 原始回放协议时钟（f32；exact same-clock 配对用）。 */
    private static float rawClockOf(final ReplayEvent e) {
        return e.timestamp() == null ? Float.NaN : e.timestamp().rawClockSec();
    }

    private static double clockOf(final ReplayEvent e, final Double startRawClockSec) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (startRawClockSec == null || !Double.isFinite(startRawClockSec)) {
            return e.timestamp().rawClockSec();
        }
        return e.timestamp().rawClockSec() - startRawClockSec;
    }
}
