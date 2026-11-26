package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.processing.TeamEntityMapping;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class RelativeDepthHpPhaseRenderer {
    private RelativeDepthHpPhaseRenderer() {
    }

    static final double HP_ADVANTAGE_RATIO = 1.2;

    static String render(
            final Battle battle,
            final List<FormationDepthEvidence.PhaseRange> phases,
            final Map<Long, List<FormationDepthEvidence.PositionSample>> tracks,
            final Map<Long, List<double[]>> hpSamples,
            final Map<Long, List<Double>> attacks,
            final Map<Long, Integer> teamByAccount,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final Long selfAccountId,
            final boolean observedDamagePartial,
            final TeamEntityMapping mapping,
            final Map<Integer, List<com.wotb.core.replay.facts.AoiObservationSegment>> aoiByEntity
    ) {
        final List<PhaseHit> hits = new ArrayList<>();
        final StringBuilder sb = new StringBuilder();
        for (final FormationDepthEvidence.PhaseRange phase : phases) {
            final PhaseResult result = renderPhase(battle, phase, tracks, hpSamples, attacks, teamByAccount,
                    playersByAccount, profiles, targets, selfAccountId != null, observedDamagePartial,
                    mapping, aoiByEntity);
            if (result.text() != null) {
                sb.append(result.text());
            }
            hits.addAll(result.hits());
        }
        if (sb.isEmpty() && hits.isEmpty()) {
            return "";
        }
        final StringBuilder out = new StringBuilder();
        out.append("\n=== RELATIVE_DEPTH_HP_MEASUREMENT（相对纵深/血量测量·确定性） ===\n");
        out.append("reference=本阶段距观测敌方最近的存活本方成员（纯几何参考，非战术角色）；"
                + "salience=成员血量比率≥reference×1.2 且距敌更远时列出\n");
        out.append(sb);
        final String aggregate = renderAggregate(hits, selfAccountId != null);
        if (!aggregate.isEmpty()) {
            out.append(aggregate);
        }
        return out.toString();
    }

    private static PhaseResult renderPhase(
            final Battle battle,
            final FormationDepthEvidence.PhaseRange phase,
            final Map<Long, List<FormationDepthEvidence.PositionSample>> tracks,
            final Map<Long, List<double[]>> hpSamples,
            final Map<Long, List<Double>> attacks,
            final Map<Long, Integer> teamByAccount,
            final Map<Long, PlayerResult> playersByAccount,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath,
            final boolean observedDamagePartial,
            final TeamEntityMapping mapping,
            final Map<Integer, List<com.wotb.core.replay.facts.AoiObservationSegment>> aoiByEntity
    ) {
        final List<PhaseHit> hits = new ArrayList<>();
        final int ownTeam = teamByAccount.getOrDefault(targets.get(0), 0);
        if (ownTeam <= 0) {
            return new PhaseResult(null, hits);
        }
        final int enemyTeam = 3 - ownTeam;
        final Map<Long, FormationDepthEvidence.PhasePositionReference> refsByAccount = new LinkedHashMap<>();
        for (final Map.Entry<Long, List<FormationDepthEvidence.PositionSample>> entry : tracks.entrySet()) {
            final int team = teamByAccount.getOrDefault(entry.getKey(), 0);
            final FormationDepthEvidence.PhasePositionReference ref =
                    FormationDepthEvidence.resolvePhasePosition(
                            battle, entry.getKey(), team, entry.getValue(),
                            phase.start(), phase.end(), playersByAccount,
                            mapping, aoiByEntity, ownTeam);
            if (ref != null) {
                refsByAccount.put(entry.getKey(), ref);
            }
        }
        if (refsByAccount.size() < 2) {
            return new PhaseResult(null, hits);
        }
        final Map<Long, FormationDepthEvidence.PhasePositionReference> ownCurrent = new LinkedHashMap<>();
        final Map<Long, FormationDepthEvidence.PhasePositionReference> enemyCurrent = new LinkedHashMap<>();
        for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : refsByAccount.entrySet()) {
            final FormationDepthEvidence.PhasePositionReference ref = entry.getValue();
            if (!ref.current()) {
                continue;
            }
            if (ref.team() == ownTeam) {
                ownCurrent.put(entry.getKey(), ref);
            } else {
                enemyCurrent.put(entry.getKey(), ref);
            }
        }
        final Map<Long, Double> distToEnemy = new LinkedHashMap<>();
        if (!enemyCurrent.isEmpty()) {
            for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : ownCurrent.entrySet()) {
                double best = Double.POSITIVE_INFINITY;
                for (final FormationDepthEvidence.PhasePositionReference e : enemyCurrent.values()) {
                    final double dx = entry.getValue().x() - e.x();
                    final double dz = entry.getValue().z() - e.z();
                    best = Math.min(best, Math.hypot(dx, dz));
                }
                distToEnemy.put(entry.getKey(), best);
            }
        }
        if (distToEnemy.size() < 2) {
            if ("opening".equals(phase.key())) {
                final String opening = renderOpeningRearTercile(ownCurrent, enemyCurrent,
                        ownTeam, profiles, targets, playerPath);
                return new PhaseResult(opening == null ? null : opening, hits);
            }
            return new PhaseResult(null, hits);
        }
        int enemyAliveCount = 0;
        int enemyRefCount = 0;
        for (final Map.Entry<Long, PlayerResult> entry : playersByAccount.entrySet()) {
            final PlayerResult pl = entry.getValue();
            if (pl == null || pl.team != enemyTeam) {
                continue;
            }
            if (!FormationDepthEvidence.isAliveAt(battle, playersByAccount, entry.getKey(), phase.end())) {
                continue;
            }
            enemyAliveCount++;
            if (enemyCurrent.containsKey(entry.getKey())) {
                enemyRefCount++;
            }
        }
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!enemyRefComplete) {
            return new PhaseResult(null, hits);
        }


        final StringBuilder sb = new StringBuilder();
        for (final long accountId : targets) {
            if (!FormationDepthEvidence.isAliveAt(battle, playersByAccount, accountId, phase.end())) {
                continue;
            }
            final Double distX = distToEnemy.get(accountId);
            if (distX == null) {
                continue;
            }
            long reference = -1L;
            double referenceDist = Double.POSITIVE_INFINITY;
            double referenceHpRatio = -1;
            for (final Map.Entry<Long, Double> entry : distToEnemy.entrySet()) {
                if (entry.getKey() == accountId) {
                    continue;
                }
                if (teamByAccount.getOrDefault(entry.getKey(), 0) != ownTeam) {
                    continue;
                }
                if (!FormationDepthEvidence.isAliveAt(battle, playersByAccount, entry.getKey(), phase.end())) {
                    continue;
                }
                if (entry.getValue() < referenceDist - 1e-9) {
                    referenceDist = entry.getValue();
                    reference = entry.getKey();
                    referenceHpRatio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                } else if (Math.abs(entry.getValue() - referenceDist) <= 1e-9) {
                    final double ratio = hpRatioAt(entry.getKey(), phase, hpSamples, playersByAccount);
                    if (ratio > referenceHpRatio) {
                        reference = entry.getKey();
                        referenceHpRatio = ratio;
                    }
                }
            }
            if (reference <= 0 || !(distX > referenceDist + 1e-9)) {
                continue;
            }
            final double hpRatioX = hpRatioAt(accountId, phase, hpSamples, playersByAccount);
            final boolean hpKnown = hpRatioX > 0 && referenceHpRatio > 0;
            final boolean hpAdvantage = hpKnown && hpRatioX >= referenceHpRatio * HP_ADVANTAGE_RATIO;
            final int observedAttackEvents = countIn(attacks.get(accountId), phase);
            final String selfLabel = playerPath ? "你" : key(accountId);
            if (hpAdvantage) {
                sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                        .append(" hpRatio=").append(pct(hpRatioX))
                        .append(" vs reference ").append(key(reference)).append(profileFacts(reference, profiles))
                        .append(" hpRatio=").append(pct(referenceHpRatio))
                        .append("（hpRatio差 ").append(fmtRatio(hpRatioX / referenceHpRatio)).append("×）")
                        .append(" memberDist=").append(Math.round(distX)).append("m")
                        .append(" referenceDist=").append(Math.round(referenceDist)).append("m")
                        .append(" relativeDepthM=+").append(Math.round(distX - referenceDist))
                        .append(" ").append(outputStatus(observedAttackEvents, observedDamagePartial)).append("\n");
                if (!(observedDamagePartial && observedAttackEvents == 0)) {
                    hits.add(new PhaseHit(accountId,
                            hpRatioX / referenceHpRatio, distX - referenceDist));
                }
            } else if (!hpKnown) {
                sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                        .append(" hpRatio=未知 HP_RATIO_UNKNOWN vs reference ").append(key(reference))
                        .append(profileFacts(reference, profiles)).append(" hpRatio=未知")
                        .append(" memberDist=").append(Math.round(distX)).append("m")
                        .append(" referenceDist=").append(Math.round(referenceDist)).append("m")
                        .append(" relativeDepthM=+").append(Math.round(distX - referenceDist))
                        .append(" observedAttackEvents=").append(observedAttackEvents).append("\n");
            }
        }
        if ("opening".equals(phase.key())) {
            final String opening = renderOpeningRearTercile(ownCurrent, enemyCurrent,
                    ownTeam, profiles, targets, playerPath);
            if (opening != null) {
                sb.append(opening);
            }
        }
        final StringBuilder out = new StringBuilder();
        out.append("phase=").append(phase.key()).append(" [")
                .append(FormationDepthEvidence.fmt(phase.start())).append("-")
                .append(FormationDepthEvidence.fmt(phase.end())).append("s]\n");
        out.append(sb);
        if (sb.length() == 0) {
            return new PhaseResult(null, hits);
        }
        return new PhaseResult(out.toString(), hits);
    }

    private static double hpRatioAt(final long accountId,
                                    final FormationDepthEvidence.PhaseRange phase,
                                    final Map<Long, List<double[]>> hpSamples,
                                    final Map<Long, PlayerResult> playersByAccount) {
        final List<double[]> samples = hpSamples.get(accountId);
        if (samples == null || samples.isEmpty()) {
            return -1;
        }
        double lastHp = -1;
        for (final double[] s : samples) {
            if (s[0] <= phase.end()) {
                lastHp = s[1];
            }
        }
        if (lastHp < 0) {
            return -1;
        }
        final PlayerResult p = playersByAccount.get(accountId);
        if (p == null || p.entryHpSource != EntryHpSource.OBSERVED_EXACT
                || p.entryHp == null || p.entryHp <= 0) {
            return -1;
        }
        return lastHp / p.entryHp;
    }

    private static String outputStatus(final int observedAttackEvents, final boolean observedDamagePartial) {
        if (observedDamagePartial) {
            return "observedAttackEvents=" + observedAttackEvents
                    + " coverage=PARTIAL（事件流观测不全，0 事件 ≠ 无输出，不得推断避战）";
        }
        return "observedAttackEvents=" + observedAttackEvents + " coverage=COMPLETE";
    }

    private static int countIn(final List<Double> times, final FormationDepthEvidence.PhaseRange phase) {
        if (times == null || times.isEmpty()) {
            return 0;
        }
        int n = 0;
        for (final double t : times) {
            if (t >= phase.start() && t <= phase.end()) {
                n++;
            }
        }
        return n;
    }

    private static String renderOpeningRearTercile(
            final Map<Long, FormationDepthEvidence.PhasePositionReference> ownCurrent,
            final Map<Long, FormationDepthEvidence.PhasePositionReference> enemyCurrent,
            final int ownTeam,
            final Map<Long, TankTacticalProfile> profiles,
            final List<Long> targets,
            final boolean playerPath
    ) {
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, FormationDepthEvidence.PhasePositionReference> entry : ownCurrent.entrySet()) {
            own.add(new java.util.AbstractMap.SimpleImmutableEntry<>(entry.getKey(),
                    new double[]{entry.getValue().x(), entry.getValue().z()}));
        }
        for (final FormationDepthEvidence.PhasePositionReference ref : enemyCurrent.values()) {
            enemyMeans.add(new double[]{ref.x(), ref.z()});
        }
        if (own.size() < 2 || enemyMeans.isEmpty()) {
            return null;
        }
        final double[] ownCentroid = FormationDepthEvidence.centroid(
                own.stream().map(Map.Entry::getValue).toList());
        final double[] enemyCentroid = FormationDepthEvidence.centroid(enemyMeans);
        final double ax = enemyCentroid[0] - ownCentroid[0];
        final double az = enemyCentroid[1] - ownCentroid[1];
        final double len = Math.hypot(ax, az);
        if (len <= 1e-6) {
            return null;
        }
        final double ux = ax / len, uz = az / len;
        final List<double[]> depths = new ArrayList<>();
        for (final Map.Entry<Long, double[]> member : own) {
            final double d = (member.getValue()[0] - ownCentroid[0]) * ux
                    + (member.getValue()[1] - ownCentroid[1]) * uz;
            depths.add(new double[]{d, member.getKey()});
        }
        depths.sort(Comparator.comparingDouble(a -> -a[0]));
        final double minD = depths.get(depths.size() - 1)[0];
        final double maxD = depths.get(0)[0];
        final double span = maxD - minD;
        final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
        final StringBuilder sb = new StringBuilder();
        for (final double[] d : depths) {
            if (d[0] > backThreshold + 1e-9) {
                continue;
            }
            final long accountId = Math.round(d[1]);
            if (!targets.contains(accountId)) {
                continue;
            }
            final String selfLabel = playerPath ? "你" : key(accountId);
            sb.append("- ").append(selfLabel).append(profileFacts(accountId, profiles))
                    .append(" opening 阶段平均位置在本方最靠后三分位（几何深度·纯几何，不判角色）\n");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private static String renderAggregate(final List<PhaseHit> hits, final boolean playerPath) {
        if (hits.isEmpty()) {
            return "";
        }
        final Map<Long, List<PhaseHit>> byAccount = new LinkedHashMap<>();
        for (final PhaseHit hit : hits) {
            byAccount.computeIfAbsent(hit.accountId(), k -> new ArrayList<>()).add(hit);
        }
        final StringBuilder sb = new StringBuilder();
        sb.append("跨阶段出现（salience filter·中性）:\n");
        for (final Map.Entry<Long, List<PhaseHit>> entry : byAccount.entrySet()) {
            final String selfLabel = playerPath ? "你" : key(entry.getKey());
            sb.append("- ").append(selfLabel).append(" 在 ").append(entry.getValue().size())
                    .append("/3 阶段成立（血量比 / 距敌差测量组合）\n");
        }
        return sb.toString();
    }

    private static String profileFacts(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "";
        }
        return "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
    }

    private static String key(final long accountId) {
        return "account:" + accountId;
    }

    private static String pct(final double ratio) {
        return Math.round(ratio * 100) + "%";
    }

    private static String fmtRatio(final double ratio) {
        return String.valueOf(Math.round(ratio * 100.0) / 100.0);
    }

    private record PhaseHit(
            long accountId,
            double bloodRatio,
            double distDiffM
    ) {
    }

    private record PhaseResult(String text, List<PhaseHit> hits) {
    }
}
