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

public final class ShotLifecycle {

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

        for (final Map.Entry<Float, List<ProjectileLaunchedEvent>> e : recByClock.entrySet()) {
            final List<ProjectileLaunchedEvent> ls = e.getValue();
            final List<Integer> rs = resIdxByClock.get(e.getKey());
            if (rs == null || rs.isEmpty()) {
                continue;
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
        }

        for (final ProjectileLaunchedEvent l : recorderLaunches) {
            if (out.containsKey(l.shotId())) {
                continue;
            }
            final float lClock = rawClockOf(l);
            if (resIdxByClock.containsKey(lClock)) {
                continue;
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
        }
        return out;
    }

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
