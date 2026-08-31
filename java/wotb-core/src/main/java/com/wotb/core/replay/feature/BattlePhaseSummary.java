package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.List;

public record BattlePhaseSummary(
        float startTime,
        float endTime,
        BattlePhaseType type,
        DecodeConfidence confidence,
        Integer friendlyAlive,
        Integer enemyAlive,
        boolean denseKills
) {
    public BattlePhaseSummary {
        if (!Float.isFinite(startTime)) throw new IllegalArgumentException("startTime must be finite");
        if (!Float.isFinite(endTime)) throw new IllegalArgumentException("endTime must be finite");
        if (startTime < 0) throw new IllegalArgumentException("startTime must be >= 0: " + startTime);
        if (endTime < 0) throw new IllegalArgumentException("endTime must be >= 0: " + endTime);
        if (startTime > endTime) throw new IllegalArgumentException("startTime > endTime: " + startTime + " > " + endTime);
        if (type == null) throw new IllegalArgumentException("type must not be null");
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
        if (friendlyAlive != null && friendlyAlive < 0) {
            throw new IllegalArgumentException("friendlyAlive must be >= 0: " + friendlyAlive);
        }
        if (enemyAlive != null && enemyAlive < 0) {
            throw new IllegalArgumentException("enemyAlive must be >= 0: " + enemyAlive);
        }
    }

    public BattlePhaseSummary(
            final float startTime,
            final float endTime,
            final BattlePhaseType type,
            final DecodeConfidence confidence
    ) {
        this(startTime, endTime, type, confidence, null, null, false);
    }

    public static final float OPENING_DURATION = 45f;
    public static final float UNKNOWN_FIRST_CONTACT = -1f;
    static final float FIRST_CONTACT_DURATION = 10f;
    static final float MID_GAME_MIN_DURATION = 60f;
    public static final float DENSE_KILL_WINDOW_SEC = 15f;
    public static final int MIN_DENSE_KILLS = 3;

    public static List<BattlePhaseSummary> buildRelativePhases(
            final float firstContactRelative,
            final float battleEndRelative
    ) {
        return buildPhases(firstContactRelative, battleEndRelative);
    }

    /**
     * Build battle-relative phases with survival counts. Death times come only from canonical
     * {@link PlayerResultFormat#deathSec(PlayerResult)}; UNKNOWN deaths make that side's exact alive count
     * unavailable rather than being placed at zero seconds.
     */
    public static List<BattlePhaseSummary> buildRelativePhasesWithSurvival(
            final float firstContactRelative,
            final float battleEndRelative,
            final SurvivalTimeline survival
    ) {
        final List<BattlePhaseSummary> phases = buildPhases(firstContactRelative, battleEndRelative);
        if (phases.isEmpty() || survival == null) {
            return phases;
        }
        final List<Double> friendlySorted =
                sortedCopy(survival.friendlyDeathTimes());
        final List<Double> enemySorted =
                sortedCopy(survival.enemyDeathTimes());
        final boolean friendlyAliveKnown = survival.friendlyRosterSize() > 0
                && survival.friendlyUnknownDeaths() == 0;
        final boolean enemyAliveKnown = survival.enemyRosterSize() > 0
                && survival.enemyUnknownDeaths() == 0;
        final List<BattlePhaseSummary> result = new ArrayList<>(phases.size());
        for (final BattlePhaseSummary phase : phases) {
            result.add(new BattlePhaseSummary(
                    phase.startTime(),
                    phase.endTime(),
                    phase.type(),
                    phase.confidence(),
                    friendlyAliveKnown ? aliveCount(friendlySorted, survival.friendlyRosterSize(), phase.endTime()) : null,
                    enemyAliveKnown ? aliveCount(enemySorted, survival.enemyRosterSize(), phase.endTime()) : null,
                    isDenseKillWindow(phase, survival)));
        }
        return result;
    }

    private static List<BattlePhaseSummary> buildPhases(
            final float firstContactRelative,
            final float battleEndRelative
    ) {
        final List<BattlePhaseSummary> phases = new ArrayList<>();
        if (!Float.isFinite(battleEndRelative) || battleEndRelative <= 0f) return phases;

        final boolean validContact = firstContactRelative >= 0
                && Float.isFinite(firstContactRelative)
                && firstContactRelative < battleEndRelative;
        final float openingEnd = validContact && firstContactRelative < OPENING_DURATION
                ? Math.min(firstContactRelative, battleEndRelative)
                : Math.min(OPENING_DURATION, battleEndRelative);
        phases.add(new BattlePhaseSummary(0f, openingEnd, BattlePhaseType.OPENING, DecodeConfidence.EXACT));

        if (validContact) {
            final float contactEnd = Math.min(firstContactRelative + FIRST_CONTACT_DURATION, battleEndRelative);
            if (contactEnd > firstContactRelative) {
                phases.add(new BattlePhaseSummary(firstContactRelative, contactEnd,
                        BattlePhaseType.FIRST_CONTACT, DecodeConfidence.INFERRED));
            }
        }

        final float prevEnd = phases.get(phases.size() - 1).endTime();
        if (battleEndRelative - prevEnd > MID_GAME_MIN_DURATION) {
            phases.add(new BattlePhaseSummary(prevEnd, battleEndRelative,
                    BattlePhaseType.MID_GAME, DecodeConfidence.INFERRED));
        }
        phases.add(new BattlePhaseSummary(battleEndRelative, battleEndRelative,
                BattlePhaseType.ENDGAME, DecodeConfidence.EXACT));
        return phases;
    }

    private static Integer aliveCount(
            final List<Double> sortedDeaths,
            final int rosterSize,
            final float endTime
    ) {
        int deaths = 0;
        for (final double deathSec : sortedDeaths) {
            if (deathSec <= endTime) {
                deaths++;
            } else {
                break;
            }
        }
        return rosterSize - deaths;
    }

    /**
     * Dense-kill window over settlement death seconds.
     */
    private static boolean isDenseKillWindow(
            final BattlePhaseSummary phase,
            final SurvivalTimeline survival
    ) {
        final List<Double> times = new ArrayList<>(survival.friendlyDeathTimes());
        times.addAll(survival.enemyDeathTimes());
        if (times.size() < MIN_DENSE_KILLS) {
            return false;
        }
        final List<Double> starts = times.stream()
                .filter(sec -> sec >= phase.startTime() && sec <= phase.endTime())
                .sorted()
                .toList();
        for (int i = 0; i < starts.size(); i++) {
            final double windowEnd = starts.get(i) + DENSE_KILL_WINDOW_SEC;
            int count = 0;
            for (int j = i; j < starts.size() && starts.get(j) <= windowEnd; j++) {
                count++;
            }
            if (count >= MIN_DENSE_KILLS) {
                return true;
            }
        }
        return false;
    }

    private static List<Double> sortedCopy(final List<Double> times) {
        return times.stream().sorted().toList();
    }

    /**
     * Survival timeline over settlement battle-relative death seconds. Invalid/missing settlement
     * death facts make exact per-phase alive counts unavailable for that side.
     */
    public record SurvivalTimeline(
            List<Double> friendlyDeathTimes,
            List<Double> enemyDeathTimes,
            int friendlyRosterSize,
            int enemyRosterSize,
            int friendlyUnknownDeaths,
            int enemyUnknownDeaths
    ) {
        public SurvivalTimeline {
            friendlyDeathTimes = friendlyDeathTimes == null ? List.of() : List.copyOf(friendlyDeathTimes);
            enemyDeathTimes = enemyDeathTimes == null ? List.of() : List.copyOf(enemyDeathTimes);
            if (friendlyRosterSize < 0) throw new IllegalArgumentException("friendlyRosterSize must be >= 0");
            if (enemyRosterSize < 0) throw new IllegalArgumentException("enemyRosterSize must be >= 0");
            if (friendlyUnknownDeaths < 0) throw new IllegalArgumentException("friendlyUnknownDeaths must be >= 0");
            if (enemyUnknownDeaths < 0) throw new IllegalArgumentException("enemyUnknownDeaths must be >= 0");
        }

        public static SurvivalTimeline fromBattleResults(
                final Battle battle,
                final Integer perspectiveTeam
        ) {
            if (battle == null || battle.players == null
                    || perspectiveTeam == null || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
                return new SurvivalTimeline(List.of(), List.of(), 0, 0, 0, 0);
            }
            final List<Double> friendlyTimes = new ArrayList<>();
            final List<Double> enemyTimes = new ArrayList<>();
            int friendlyRoster = 0;
            int enemyRoster = 0;
            int friendlyUnknown = 0;
            int enemyUnknown = 0;
            for (final PlayerResult p : battle.players) {
                if (!PlayerSideResolver.isValidRawTeam(p.team)) {
                    continue;
                }
                final boolean friendly = p.team == perspectiveTeam;
                if (friendly) {
                    friendlyRoster++;
                } else {
                    enemyRoster++;
                }
                if (p.survived) {
                    continue;
                }
                final double deathSec = PlayerResultFormat.deathSec(p);
                if (deathSec > 0) {
                    (friendly ? friendlyTimes : enemyTimes).add(deathSec);
                } else if (friendly) {
                    friendlyUnknown++;
                } else {
                    enemyUnknown++;
                }
            }
            return new SurvivalTimeline(
                    friendlyTimes, enemyTimes,
                    friendlyRoster, enemyRoster,
                    friendlyUnknown, enemyUnknown);
        }
    }
}
