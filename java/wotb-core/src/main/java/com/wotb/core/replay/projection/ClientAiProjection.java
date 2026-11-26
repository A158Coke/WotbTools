package com.wotb.core.replay.projection;

import java.util.List;

public record ClientAiProjection(
        Engine engine,
        Clock clock,
        Perspective perspective,
        List<Participant> participants,
        List<ObservationWindow> observationWindows,
        List<SampleTrack> positions,
        List<SampleTrack> turrets,
        List<Prop3Health> prop3Health,
        List<HealthEvent> healthEvents,
        List<DamageNotice> damageNotices,
        List<Period> periods,
        Objectives objectives,
        List<String> limitations,
        List<String> unavailableEvidence
) {
    public record Engine(String agentRelease, String agentCommit) {
    }

    public record Clock(double battleStartRawClockSec, double battleDurationSec, boolean estimated,
                        Double battleEndRawClockSec, Double streamEndRawClockSec) {
    }

    public record Perspective(Long recorderAccountId, Integer perspectiveTeam,
                              List<Integer> recorderEntityIds, Integer winnerTeam) {
    }

    public record Participant(int entityId, long accountId, String nickname, int team, int tankId,
                              boolean recorder) {
    }

    public record ObservationWindow(int entityId, double fromRawClockSec, Double toRawClockSec,
                                    Integer materializationHp) {
    }

    public record SampleTrack(int entityId, int stride, double[] samples) {
    }

    public record Prop3Health(int entityId, double rawClockSec, int hpRaw, String hpState) {
    }

    public record HealthEvent(int entityId, double rawClockSec, int hpRaw, int sourceEntityId, int causeFlag, String hpState) {
    }

    public enum DamageNoticeKind { HIT, UNDECODED_VARIANT, SHORT_VARIANT }

    public record DamageNotice(double rawClockSec, DamageNoticeKind kind, int envelopeEntityId,
                               int attackerEntityId, int victimEntityId,
                               Integer primaryResult, Integer secondaryResult) {
    }

    public record Period(double rawClockSec, int period) {
    }

    public record Objectives(List<PointsSample> supremacyPoints, List<SupremacyBase> supremacyBases,
                             boolean assaultObjectivePresent, List<AssaultBase> assaultBases) {
    }

    public record PointsSample(double rawClockSec, int team, int points) {
    }

    public record SupremacyBase(double rawClockSec, String baseId, Integer ownerTeam, Integer capturingTeam,
                                Integer captureProgress) {
    }

    public record AssaultBase(double rawClockSec, int captureProgress) {
    }
}
