package com.wotb.ai.review;

import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.timeline.PositionKnowledge;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class FormationDepthPositionResolver {

    private FormationDepthPositionResolver() {
    }

    record PositionSample(int entityId, double t, double x, double z) {
    }

    record PhasePositionReference(
            long accountId,
            int team,
            double x,
            double z,
            PositionKnowledge knowledge,
            double observedAtSec,
            double ageSec
    ) {
        boolean current() {
            return knowledge == PositionKnowledge.CURRENT;
        }
    }

    static PhasePositionReference resolvePhasePosition(
            final boolean aliveAtPhaseEnd,
            final long accountId,
            final int team,
            final List<PositionSample> samples,
            final double phaseStart,
            final double phaseEnd,
            final TeamEntityMapping mapping,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity) {
        if (!aliveAtPhaseEnd) {
            return null;
        }
        final AoiObservationSegment segment = observedSegmentAt(aoiByEntity, mapping, accountId, phaseEnd);
        final int targetEntity = segment != null ? segment.entityId() : lastObservedEntityId(samples, phaseEnd);
        final List<PositionSample> entitySamples = sameEntitySamples(samples, targetEntity);
        if (entitySamples.isEmpty()) {
            return null;
        }
        double sumX = 0;
        double sumZ = 0;
        int count = 0;
        double lastInWindow = -1;
        if (segment != null) {
            final double segmentStart = Math.max(phaseStart, segment.observedFromSec());
            final double segmentEnd = segment.absentFromSec() != null
                    ? Math.min(phaseEnd, segment.absentFromSec()) : phaseEnd;
            for (final PositionSample sample : entitySamples) {
                if (sample.t() < segmentStart || sample.t() > segmentEnd) {
                    continue;
                }
                sumX += sample.x();
                sumZ += sample.z();
                count++;
                lastInWindow = Math.max(lastInWindow, sample.t());
            }
        }
        final double x;
        final double z;
        final double observedAt;
        final PositionKnowledge knowledge;
        if (count > 0) {
            x = sumX / count;
            z = sumZ / count;
            observedAt = lastInWindow;
            knowledge = PositionKnowledge.CURRENT;
        } else {
            final double[] carry = carriedForwardReference(entitySamples, phaseEnd);
            if (carry == null) {
                return null;
            }
            x = carry[1];
            z = carry[2];
            observedAt = carry[0];
            knowledge = segment != null
                    && observedAt >= segment.observedFromSec() - 1e-9
                    && (segment.absentFromSec() == null || observedAt < segment.absentFromSec() - 1e-9)
                    ? PositionKnowledge.CURRENT : PositionKnowledge.LAST_KNOWN;
        }
        return new PhasePositionReference(accountId, team, x, z, knowledge, observedAt, phaseEnd - observedAt);
    }

    static double[] carriedForwardReference(final List<PositionSample> samples, final double phaseEnd) {
        double[] carry = null;
        for (final PositionSample sample : samples) {
            if (sample.t() <= phaseEnd + 1e-6) {
                carry = new double[]{sample.t(), sample.x(), sample.z()};
            } else {
                break;
            }
        }
        return carry;
    }

    private static AoiObservationSegment observedSegmentAt(
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final TeamEntityMapping mapping,
            final long accountId,
            final double phaseEnd) {
        if (mapping == null || aoiByEntity == null) {
            return null;
        }
        for (final int entityId : mapping.entityIds(accountId)) {
            final AoiObservationSegment segment = ReplayAoiLifecycle.segmentAt(aoiByEntity, entityId, phaseEnd);
            if (segment != null) {
                return segment;
            }
        }
        return null;
    }

    private static List<PositionSample> sameEntitySamples(final List<PositionSample> samples, final int entityId) {
        if (samples == null || entityId <= 0) {
            return List.of();
        }
        final List<PositionSample> result = new ArrayList<>();
        for (final PositionSample sample : samples) {
            if (sample.entityId() == entityId) {
                result.add(sample);
            }
        }
        return result;
    }

    private static int lastObservedEntityId(final List<PositionSample> samples, final double phaseEnd) {
        double bestTime = -Double.MAX_VALUE;
        int bestEntity = -1;
        for (final PositionSample sample : samples) {
            if (sample.t() > phaseEnd + 1e-6) {
                continue;
            }
            if (bestEntity < 0 || sample.t() > bestTime + 1e-9
                    || (Math.abs(sample.t() - bestTime) <= 1e-9 && sample.entityId() < bestEntity)) {
                bestTime = sample.t();
                bestEntity = sample.entityId();
            }
        }
        return bestEntity;
    }
}
