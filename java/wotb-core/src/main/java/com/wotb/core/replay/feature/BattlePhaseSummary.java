package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.ArrayList;
import java.util.List;

public record BattlePhaseSummary(
        float startTime,
        float endTime,
        BattlePhaseType type,
        DecodeConfidence confidence
) {
    public BattlePhaseSummary {
        if (!Float.isFinite(startTime)) throw new IllegalArgumentException("startTime must be finite");
        if (!Float.isFinite(endTime)) throw new IllegalArgumentException("endTime must be finite");
        if (startTime < 0) throw new IllegalArgumentException("startTime must be >= 0: " + startTime);
        if (endTime < 0) throw new IllegalArgumentException("endTime must be >= 0: " + endTime);
        if (startTime > endTime) throw new IllegalArgumentException("startTime > endTime: " + startTime + " > " + endTime);
        if (type == null) throw new IllegalArgumentException("type must not be null");
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
    }

    // ---- Shared constants for phase building ----

    public static final float OPENING_DURATION = 45f;
    public static final float UNKNOWN_FIRST_CONTACT = -1f;
    static final float FIRST_CONTACT_DURATION = 10f;
    static final float MID_GAME_MIN_DURATION = 60f;

    /**
     * Build battle-relative phases.
     * <p>
     * Time semantics (all battle-relative seconds, battle start = 0):
     * <ul>
     *   <li>{@code firstContactRelative}: first contact time; {@code <0} or non-finite means unknown
     *       (see {@link #UNKNOWN_FIRST_CONTACT}). {@code 0} is a valid contact time.</li>
     *   <li>{@code battleEndRelative}: battle end time, must be finite and {@code >=0}.</li>
     * </ul>
     * Every returned phase satisfies: start/end are finite, {@code >=0}, {@code start<=end},
     * {@code end<=battleEndRelative}. Returns empty list when no credible timeline exists.
     */
    public static List<BattlePhaseSummary> buildRelativePhases(
            final float firstContactRelative,
            final float battleEndRelative
    ) {
        if (!Float.isFinite(battleEndRelative) || battleEndRelative < 0f) {
            return List.of();
        }

        final boolean hasFirstContact = Float.isFinite(firstContactRelative)
                && firstContactRelative >= 0f
                && firstContactRelative <= battleEndRelative;

        final List<BattlePhaseSummary> phases = new ArrayList<>();

        float openingEnd = Math.min(OPENING_DURATION, battleEndRelative);
        if (hasFirstContact) {
            openingEnd = Math.min(openingEnd, firstContactRelative);
        }
        phases.add(new BattlePhaseSummary(
                0f, openingEnd, BattlePhaseType.OPENING, DecodeConfidence.EXACT));

        if (hasFirstContact) {
            final float contactEnd = Math.min(
                    firstContactRelative + FIRST_CONTACT_DURATION, battleEndRelative);
            phases.add(new BattlePhaseSummary(
                    firstContactRelative, contactEnd,
                    BattlePhaseType.FIRST_CONTACT, DecodeConfidence.INFERRED));
        }

        if (battleEndRelative - openingEnd > MID_GAME_MIN_DURATION) {
            phases.add(new BattlePhaseSummary(
                    openingEnd, battleEndRelative,
                    BattlePhaseType.MID_GAME, DecodeConfidence.INFERRED));
        }

        phases.add(new BattlePhaseSummary(
                battleEndRelative, battleEndRelative,
                BattlePhaseType.ENDGAME, DecodeConfidence.EXACT));
        return phases;
    }
}
