package com.wotb.core.replay.evidence;

import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class SeparationWindowAnalyzer {
    static final int MAIN_CLUSTER_DOMINANCE = 2;
    static final float SPAN_CONTINUITY_EPSILON_SEC = 0.01f;

    private SeparationWindowAnalyzer() {
    }

    static List<SeparationSpan> separationSpans(final TeamMemberFeatureSet member,
                                                final List<TeamFormationPhase> phases,
                                                final List<TeamMemberFeatureSet> allMembers) {
        final List<SeparationSpan> spans = new ArrayList<>();
        SeparationSpan current = null;
        for (final TeamFormationPhase phase : phases) {
            final WindowInfo info = windowInfo(member, phase, allMembers);
            if (info.separated()) {
                if (current == null) {
                    current = new SeparationSpan(member, phase.startTime(), phase.endTime(), info);
                } else if (phase.startTime() <= current.endSec() + SPAN_CONTINUITY_EPSILON_SEC
                        && phase.startTime() >= current.endSec() - SPAN_CONTINUITY_EPSILON_SEC) {
                    current = current.extend(phase.endTime(), info);
                } else {
                    spans.add(current);
                    current = new SeparationSpan(member, phase.startTime(), phase.endTime(), info);
                }
            } else if (current != null) {
                spans.add(current);
                current = null;
            }
        }
        if (current != null) {
            spans.add(current);
        }
        return spans;
    }

    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase) {
        if (phase == null || phase.clusters() == null || phase.clusters().isEmpty()) {
            return null;
        }
        TeamFormationCluster main = null;
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (main == null || cluster.memberCount() > main.memberCount()) {
                main = cluster;
            }
        }
        if (main == null) {
            return null;
        }
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (cluster != main && cluster.memberCount() == main.memberCount()) {
                return null;
            }
        }
        return main;
    }

    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase,
                                              final int expectedAliveMembers) {
        if (expectedAliveMembers <= 0 || phase == null
                || phase.observedMemberCount() < expectedAliveMembers) {
            return null;
        }
        return mainClusterOf(phase);
    }

    private static WindowInfo windowInfo(final TeamMemberFeatureSet member,
                                         final TeamFormationPhase phase,
                                         final List<TeamMemberFeatureSet> allMembers) {
        final TeamFormationCluster main = mainClusterOf(
                phase, expectedAliveMembers(allMembers, phase));
        if (main == null) {
            return WindowInfo.NOT_SEPARATED;
        }
        final String memberKey = identityKey(member);
        TeamFormationCluster memberCluster = null;
        for (final TeamFormationCluster cluster : phase.clusters()) {
            if (cluster.memberIdentities().contains(memberKey)) {
                memberCluster = cluster;
                break;
            }
        }
        if (memberCluster == null || memberCluster == main) {
            return WindowInfo.NOT_SEPARATED;
        }
        if (main.memberCount() < memberCluster.memberCount() + MAIN_CLUSTER_DOMINANCE) {
            return WindowInfo.NOT_SEPARATED;
        }
        final float distance = distance(
                memberCluster.centroidX(), memberCluster.centroidZ(),
                main.centroidX(), main.centroidZ());
        if (distance < SeparationThresholds.SEPARATION_DISTANCE_M) {
            return WindowInfo.NOT_SEPARATED;
        }
        return new WindowInfo(true, distance, memberCluster.centroid().region(),
                main.centroidX(), main.centroidZ());
    }

    private static int expectedAliveMembers(final List<TeamMemberFeatureSet> members,
                                            final TeamFormationPhase phase) {
        int alive = 0;
        for (final TeamMemberFeatureSet member : members) {
            final Double deathTimeSec = member.deathTimeSec();
            if (deathTimeSec == null || !Double.isFinite(deathTimeSec)
                    || deathTimeSec > phase.startTime()) {
                alive++;
            }
        }
        return alive;
    }

    static Double stationaryRatio(final TeamMemberFeatureSet member,
                                  final SeparationSpan span) {
        float covered = 0f;
        float stationary = 0f;
        for (final MovementSegment segment : member.movements()) {
            final float overlapStart = Math.max(segment.startTime(), span.startSec());
            final float overlapEnd = Math.min(segment.endTime(), span.endSec());
            if (overlapEnd <= overlapStart) {
                continue;
            }
            final float duration = overlapEnd - overlapStart;
            covered += duration;
            if (segment.type() == MovementType.STATIONARY
                    || segment.averageSpeed() < SeparationThresholds.STATIONARY_SPEED_MPS) {
                stationary += duration;
            }
        }
        final float spanDuration = span.durationSec();
        if (covered <= 0f || spanDuration <= 0f
                || covered / spanDuration < SeparationThresholds.MIN_MOVEMENT_COVERAGE_RATIO) {
            return null;
        }
        return (double) stationary / covered;
    }

    static int[] otherFriendlyActivity(final List<TeamMemberFeatureSet> members,
                                       final SeparationSpan span,
                                       final TeamMemberFeatureSet soloMember) {
        int deaths = 0;
        int engagements = 0;
        float dealt = 0f;
        float received = 0f;
        for (final TeamMemberFeatureSet member : members) {
            if (member.accountId() == soloMember.accountId()) {
                continue;
            }
            if (!member.survived() && member.deathTimeSec() != null
                    && member.deathTimeSec() >= span.startSec()
                    && member.deathTimeSec() <= span.endSec()) {
                deaths++;
            }
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, span.startSec(), span.endSec())) {
                    engagements++;
                    dealt += engagement.damageDealt();
                    received += engagement.damageReceived();
                }
            }
        }
        return new int[]{deaths, engagements, (int) dealt, (int) received};
    }

    static boolean memberDeadIn(final TeamMemberFeatureSet member, final SeparationSpan span) {
        return !member.survived() && member.deathTimeSec() != null
                && member.deathTimeSec() >= span.startSec()
                && member.deathTimeSec() <= span.endSec();
    }

    private static String identityKey(final TeamMemberFeatureSet member) {
        return member.accountId() > 0
                ? "account:" + member.accountId()
                : "nickname:" + member.nickname();
    }

    private static float distance(final float x1, final float z1,
                                  final float x2, final float z2) {
        final float dx = x1 - x2;
        final float dz = z1 - z2;
        return (float) Math.sqrt(dx * dx + dz * dz);
    }

    private static boolean fullyContained(final EngagementSummary engagement,
                                          final float startSec, final float endSec) {
        return engagement.startTime() >= startSec - SPAN_CONTINUITY_EPSILON_SEC
                && engagement.endTime() <= endSec + SPAN_CONTINUITY_EPSILON_SEC;
    }

    private static boolean intersects(final EngagementSummary engagement,
                                      final float startSec, final float endSec) {
        return engagement.startTime() <= endSec && engagement.endTime() >= startSec;
    }

    static final class SeparationSpan {
        private final TeamMemberFeatureSet member;
        private final float startSec;
        private final float endSec;
        private final List<WindowInfo> windows = new ArrayList<>();

        SeparationSpan(final TeamMemberFeatureSet member, final float startSec,
                       final float endSec, final WindowInfo window) {
            this.member = member;
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.add(window);
        }

        SeparationSpan extend(final float endSec, final WindowInfo window) {
            final SeparationSpan extended = new SeparationSpan(member, startSec, endSec, windows);
            extended.windows.add(window);
            return extended;
        }

        private SeparationSpan(final TeamMemberFeatureSet member, final float startSec,
                               final float endSec, final List<WindowInfo> windows) {
            this.member = member;
            this.startSec = startSec;
            this.endSec = endSec;
            this.windows.addAll(windows);
        }

        float startSec() {
            return startSec;
        }

        float endSec() {
            return endSec;
        }

        float durationSec() {
            return endSec - startSec;
        }

        float maxDistanceM() {
            return windows.stream().map(WindowInfo::distanceM).max(Float::compare).orElse(0f);
        }

        float distanceGrowthM() {
            if (windows.size() < 2) {
                return 0f;
            }
            return windows.getLast().distanceM() - windows.getFirst().distanceM();
        }

        float mainCentroidDisplacementM() {
            if (windows.size() < 2) {
                return 0f;
            }
            final WindowInfo first = windows.getFirst();
            final WindowInfo last = windows.getLast();
            return distance(first.mainCentroidX(), first.mainCentroidZ(),
                    last.mainCentroidX(), last.mainCentroidZ());
        }

        WindowInfo regionInfo() {
            return windows.getLast();
        }

        int enemyPressureCount() {
            final Set<Long> enemies = new LinkedHashSet<>();
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    enemies.addAll(engagement.enemyAccountIds());
                }
            }
            return enemies.size();
        }

        float damageReceived() {
            float damage = 0f;
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    damage += engagement.damageReceived();
                }
            }
            return damage;
        }

        float damageDealt() {
            float damage = 0f;
            for (final EngagementSummary engagement : member.engagements()) {
                if (fullyContained(engagement, startSec, endSec)) {
                    damage += engagement.damageDealt();
                }
            }
            return damage;
        }

        boolean hasPartialOverlapEngagement() {
            for (final EngagementSummary engagement : member.engagements()) {
                if (intersects(engagement, startSec, endSec)
                        && !fullyContained(engagement, startSec, endSec)) {
                    return true;
                }
            }
            return false;
        }
    }

    record WindowInfo(boolean separated, float distanceM, int region,
                      float mainCentroidX, float mainCentroidZ) {
        static final WindowInfo NOT_SEPARATED = new WindowInfo(
                false, 0f, 0, 0f, 0f);
    }
}
