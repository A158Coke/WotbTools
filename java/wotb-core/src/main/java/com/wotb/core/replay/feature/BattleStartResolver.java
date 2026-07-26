package com.wotb.core.replay.feature;

import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import java.util.List;

/**
 * Determines battle start time from replay diagnostics.
 * <p>
 * Strategy (in priority order):
 * <ol>
 *   <li>If the stream reader already identified a battle-start event, use it.</li>
 *   <li>If {@code firstClockSec < 0}, the replay clock includes countdown;
 *       use {@code clock = 0} as the start of active battle.</li>
 *   <li>If {@code firstClockSec >= 0}, use the first clock as a conservative estimate.</li>
 * </ol>
 */
public final class BattleStartResolver {

    private BattleStartResolver() {}

    /**
     * Resolve the raw clock second at which active battle begins.
     * Falls back to computing from firstClockSec when diagnostics has no identified start.
     * @return battle start raw clock, or null if unresolvable
     */
    public static Float resolveStart(final ReplayStreamDiagnostics diagnostics) {
        if (diagnostics == null) return null;
        if (diagnostics.battleStartIdentified() && diagnostics.battleStartRawClockSec() != null) {
            return diagnostics.battleStartRawClockSec();
        }
        return inferFromFirstClock(diagnostics.firstClockSec());
    }

    /**
     * Infer battle start from the first clock value in the stream.
     * Strategy: if firstClockSec < 0, the replay clock includes countdown
     * and clock=0 is the active battle start.
     * If firstClockSec >= 0, use it as a conservative estimate.
     */
    public static Float inferFromFirstClock(final float firstClockSec) {
        if (!Float.isFinite(firstClockSec)) return null;
        if (firstClockSec < 0) return 0f;
        return firstClockSec;
    }

    /**
     * Compute a battle-relative clock for an event, given the battle start.
     * @return battleClockSec (raw - start), or raw clock if start is null
     */
    public static float battleRelative(final float rawClockSec, final Float battleStartRawClockSec) {
        if (battleStartRawClockSec != null) {
            return rawClockSec - battleStartRawClockSec;
        }
        return rawClockSec;
    }

    /**
     * Check whether a raw clock is in the pre-battle setup phase.
     */
    public static boolean isPreBattle(final float rawClockSec, final Float battleStartRawClockSec) {
        if (battleStartRawClockSec == null) return false;
        return rawClockSec < battleStartRawClockSec;
    }

    /** Pre-battle limitations. */
    public static final String PRE_BATTLE_UNRESOLVED = "PRE_BATTLE_START_UNRESOLVED";
    public static final String PRE_BATTLE_ESTIMATED = "PRE_BATTLE_START_ESTIMATED";
}
