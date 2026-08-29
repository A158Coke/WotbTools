package com.wotb.core.replay.facts;

/** Canonical recorder-shot targeting facts joined from method36 + Type31 + Type39. */
public record TargetingShotPair(
        int shotId,
        Double turretYawBeforeShotRad,
        Double gunPitchBeforeShotRad,
        Double aimingTimeScalarBefore,
        Double dispersionBloomBefore,
        Double dispersionBloomAfter,
        Double bloomIncreaseAfterShot,
        Float gunMarkerSizeBeforeShot,
        Float worldAimYawDegBeforeShot,
        Float worldAimPitchDegBeforeShot,
        Float aimRayPointX,
        Float aimRayPointY,
        Float aimRayPointZ
) {
    /** Backward-compatible constructor for tests/callers that only model method36. */
    public TargetingShotPair(
            final int shotId,
            final Double turretYawBeforeShotRad,
            final Double gunPitchBeforeShotRad,
            final Double aimingTimeScalarBefore,
            final Double dispersionBloomBefore,
            final Double dispersionBloomAfter,
            final Double bloomIncreaseAfterShot) {
        this(shotId, turretYawBeforeShotRad, gunPitchBeforeShotRad,
                aimingTimeScalarBefore, dispersionBloomBefore, dispersionBloomAfter,
                bloomIncreaseAfterShot, null, null, null, null, null, null);
    }
}
