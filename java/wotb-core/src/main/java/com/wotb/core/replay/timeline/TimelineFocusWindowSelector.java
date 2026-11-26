package com.wotb.core.replay.timeline;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class TimelineFocusWindowSelector {

    public static final int MAX_WINDOWS = 3;
    public static final double WINDOW_SEC = 20.0;
    static final double MIN_CANDIDATE_SCORE = 120.0;

    private TimelineFocusWindowSelector() {
    }

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

        final List<Candidate> candidates = new ArrayList<>();
        candidates.addAll(deathWindows(timeline, all));
        candidates.addAll(nonDeathClusters(timeline, all, candidates));

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
                continue;
            }
            out.add(buildCandidate(timeline, all, coreDeaths));
        }
        return out;
    }

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