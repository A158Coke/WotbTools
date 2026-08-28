package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.AmmunitionSelectionChangedEvent;
import com.wotb.core.replay.event.AmmunitionStateEvent;
import com.wotb.core.replay.event.DecodeConfidence;
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
 * 射击生命周期组装器（计划 §C1）。
 *
 * <p>从事件流组装 canonical {@link ShotFact}：method29 launch 为锚点，按 shotId 配对
 * method20/27；Type28/method17 在发射时刻取最近先前的状态（跨 arena/init 边界不继承——
 * 无状态即 UNKNOWN）；method38 无 shotId，仅在窗口内唯一时才配对（多发射同刻 → UNKNOWN，
 * 防止错误归因）。</p>
 */
public final class ShotLifecycle {

    /** method38 与 launch 配对的最大时间窗（秒）；同窗内多个 launch → 不配对。 */
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
        final List<ShotFact> facts = new ArrayList<>();
        for (final ProjectileLaunchedEvent launch : launches.values()) {
            final double t = clockOf(launch, startRawClockSec);
            final ProjectileTerminalEvent terminal = terminals.get(launch.shotId());
            final ShotResolution resolution = matchShotResult(launch, results, startRawClockSec,
                    recorderEntityIds);
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

    /** method38 无 shotId：窗口内唯一 launch 时才配对；同窗多 launch → UNKNOWN。 */
    private static ShotResolution matchShotResult(
            final ProjectileLaunchedEvent launch,
            final List<ShotResultEvent> results,
            final Double startRawClockSec,
            final List<Integer> recorderEntityIds) {
        // method38 是 recorder-local outgoing result：只对已闭合为录像者的射击配对
        if (!recorderEntityIds.contains(launch.shooterEntityId())) {
            return null;
        }
        final double t = clockOf(launch, startRawClockSec);
        final List<ShotResultEvent> candidates = new ArrayList<>();
        for (final ShotResultEvent r : results) {
            final double rt = clockOf(r, startRawClockSec);
            if (Math.abs(rt - t) <= SHOT_RESULT_WINDOW_SEC) {
                candidates.add(r);
            }
        }
        if (candidates.size() != 1) {
            // 同窗多 result / 无 result：不得臆测配对（method38 是 recorder-local，
            // 但多发射同刻时无法唯一归因）
            return null;
        }
        return ShotResolution.of(candidates.getFirst().resultFlags16(),
                candidates.getFirst().modifierIds(),
                candidates.getFirst().components());
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
