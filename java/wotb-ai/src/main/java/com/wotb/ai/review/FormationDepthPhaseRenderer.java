package com.wotb.ai.review;

import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class FormationDepthPhaseRenderer {

    private FormationDepthPhaseRenderer() {
    }

    record PositionReference(double x, double z, double observedAtSec, double ageSec) {
    }

    static String renderPhase(
            final String phaseKey,
            final double phaseStart,
            final double phaseEnd,
            final Map<Long, PositionReference> ownCurrent,
            final Map<Long, PositionReference> enemyCurrent,
            final Map<Long, PositionReference> enemyLastKnown,
            final Map<Long, TankTacticalProfile> profiles,
            final String mapCode,
            final int ownRefCount,
            final int enemyRefCount,
            final int ownAliveCount,
            final int enemyAliveCount
    ) {
        final Map<Integer, Integer> ownRegionCount = new LinkedHashMap<>();
        final Map<Integer, Integer> enemyRegionCount = new LinkedHashMap<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                ownRegionCount.merge(region, 1, Integer::sum);
            }
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            final int region = regionOf(entry.getValue(), mapCode);
            if (region > 0) {
                enemyRegionCount.merge(region, 1, Integer::sum);
            }
        }
        final Map<Long, double[]> ownCanonical = new LinkedHashMap<>();
        final Map<Long, double[]> enemyCanonical = new LinkedHashMap<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                ownCanonical.put(entry.getKey(), canonical);
            }
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            final double[] canonical = canonicalOf(entry.getValue(), mapCode);
            if (canonical != null) {
                enemyCanonical.put(entry.getKey(), canonical);
            }
        }
        final StringBuilder sb = new StringBuilder();
        final String header = phaseHeader(phaseKey, phaseStart, phaseEnd);

        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        final List<Map.Entry<Long, double[]>> own = new ArrayList<>();
        final List<double[]> enemyMeans = new ArrayList<>();
        for (final Map.Entry<Long, PositionReference> entry : ownCurrent.entrySet()) {
            own.add(new java.util.AbstractMap.SimpleImmutableEntry<>(entry.getKey(),
                    new double[]{entry.getValue().x(), entry.getValue().z()}));
        }
        for (final Map.Entry<Long, PositionReference> entry : enemyCurrent.entrySet()) {
            enemyMeans.add(new double[]{entry.getValue().x(), entry.getValue().z()});
        }
        if (ownRefComplete && enemyRefComplete && own.size() >= 2 && !enemyMeans.isEmpty()) {
            final double[] ownCentroid = FormationDepthMath.centroid(own.stream().map(Map.Entry::getValue).toList());
            final double[] enemyCentroid = FormationDepthMath.centroid(enemyMeans);
            final double ax = enemyCentroid[0] - ownCentroid[0];
            final double az = enemyCentroid[1] - ownCentroid[1];
            final double len = Math.hypot(ax, az);
            if (len > 1e-6) {
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
                final double frontThreshold = span > 1e-6 ? minD + span * 2.0 / 3.0 : maxD;
                final double backThreshold = span > 1e-6 ? minD + span / 3.0 : maxD;
                final List<String> geometricForward = new ArrayList<>();
                final List<String> geometricMiddle = new ArrayList<>();
                final List<String> geometricRear = new ArrayList<>();
                for (final double[] d : depths) {
                    final String key = annotate(Math.round(d[1]), profiles);
                    if (d[0] >= frontThreshold - 1e-9) {
                        geometricForward.add(key);
                    } else if (d[0] <= backThreshold + 1e-9) {
                        geometricRear.add(key);
                    } else {
                        geometricMiddle.add(key);
                    }
                }
                sb.append(header)
                        .append("GEOMETRIC_FORWARD=").append(String.join(",", geometricForward)).append("\n")
                        .append("GEOMETRIC_MIDDLE=").append(String.join(",", geometricMiddle)).append("\n")
                        .append("GEOMETRIC_REAR=").append(String.join(",", geometricRear)).append("\n");
                return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                        ownCanonical, enemyCanonical, profiles, mapCode,
                        ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                        enemyLastKnown);
            }
        }
        sb.append(header);
        return sb.toString() + renderCoverage(ownRegionCount, enemyRegionCount,
                ownCanonical, enemyCanonical, profiles, mapCode,
                ownRefCount, enemyRefCount, ownAliveCount, enemyAliveCount,
                enemyLastKnown);
    }

    private static int regionOf(final PositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable()) {
            return 0;
        }
        return res.region();
    }

    private static double[] canonicalOf(final PositionReference ref, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(
                (float) ref.x(), (float) ref.z(), mapCode);
        if (res == null || !res.usable() || res.position() == null) {
            return null;
        }
        return new double[]{res.position().x(), res.position().z()};
    }

    private static String annotate(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        if (profile == null || "UNKNOWN".equals(profile.vehicleClass())) {
            return "account:" + accountId + "(UNKNOWN)";
        }
        return "account:" + accountId + "(" + profile.vehicleClass() + ",armor=" + profile.armorReliability() + ")";
    }
    private static String renderCoverage(
            final Map<Integer, Integer> own,
            final Map<Integer, Integer> enemy,
            final Map<Long, double[]> ownCanonical,
            final Map<Long, double[]> enemyCanonical,
            final Map<Long, TankTacticalProfile> profiles,
            final String mapCode,
            final int ownRefCount,
            final int enemyRefCount,
            final int ownAliveCount,
            final int enemyAliveCount,
            final Map<Long, PositionReference> enemyLastKnown
    ) {
        final boolean ownRefComplete = ownRefCount >= ownAliveCount;
        final boolean enemyRefComplete = enemyRefCount >= enemyAliveCount;
        if (!ownRefComplete || !enemyRefComplete) {
            final StringBuilder fail = new StringBuilder();
            final List<String> presence = new ArrayList<>(own.keySet().stream()
                    .sorted().map(r -> "GRID_REGION_" + r).toList());
            fail.append("REGION_COVERAGE_MEASUREMENTS（POSITION_COVERAGE_INSUFFICIENT：")
                    .append("ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount).append("）\n");
            if (!presence.isEmpty()) {
                fail.append("ownPositionPresence=").append(String.join(",", presence)).append("\n");
            }
            if (!enemyLastKnown.isEmpty()) {
                fail.append("ENEMY_LAST_KNOWN_POSITION_REFERENCES（独立信息，不得当作当前精确位置）:\n");
                final List<Map.Entry<Long, PositionReference>> lastKnown =
                        new ArrayList<>(enemyLastKnown.entrySet());
                lastKnown.sort(java.util.Comparator.comparingLong(Map.Entry::getKey));
                for (final Map.Entry<Long, PositionReference> entry : lastKnown) {
                    final PositionReference ref = entry.getValue();
                    final int region = regionOf(ref, mapCode);
                    fail.append("  account:").append(entry.getKey())
                            .append(" region=").append(region > 0 ? "GRID_REGION_" + region : "UNKNOWN")
                            .append(" observedAtSec=").append(FormationDepthMath.fmt(ref.observedAtSec()))
                            .append(" ageSec=").append(FormationDepthMath.fmt(ref.ageSec()))
                            .append(" knowledge=LAST_KNOWN\n");
                }
            }
            return fail.toString();
        }
        final java.util.Set<Integer> regions = new java.util.LinkedHashSet<>();
        regions.addAll(own.keySet());
        regions.addAll(enemy.keySet());
        final StringBuilder sb = new StringBuilder();
        sb.append("REGION_COVERAGE_MEASUREMENTS（区域覆盖测量·确定性；LLM 自行判断含义）:\n");
        for (final int region : regions) {
            final double fOwn = fireCoverage(region, ownCanonical, profiles);
            final double fEnemy = fireCoverage(region, enemyCanonical, profiles);
            final int ownPresence = own.getOrDefault(region, 0);
            final int enemyPresence = enemy.getOrDefault(region, 0);
            sb.append("  GRID_REGION_").append(region)
                    .append(" ownPositionPresence=").append(ownPresence)
                    .append(" enemyPositionPresence=").append(enemyPresence)
                    .append(" ownWeightedCoverageScore=").append(FormationDepthMath.fmt(fOwn))
                    .append(" enemyWeightedCoverageScore=").append(FormationDepthMath.fmt(fEnemy))
                    .append(" ratio=").append(FormationDepthMath.fmt(ratioOf(fOwn, fEnemy)))
                    .append(" coverageCompleteness=ownRef=").append(ownRefCount).append("/").append(ownAliveCount)
                    .append(" enemyRef=").append(enemyRefCount).append("/").append(enemyAliveCount)
                    .append("\n");
        }
        return sb.toString();
    }

    private static double ratioOf(final double own, final double enemy) {
        if (own <= 0 && enemy <= 0) {
            return 1.0;
        }
        if (own <= 0 || enemy <= 0) {
            return 0.0;
        }
        return own / enemy;
    }

    static final double FIRE_DISTANCE_NORM_M = 100.0;

    private static double fireCoverage(final int region, final Map<Long, double[]> positions,
                                       final Map<Long, TankTacticalProfile> profiles) {
        final double[] center = regionCenter(region);
        double f = 0;
        for (final Map.Entry<Long, double[]> entry : positions.entrySet()) {
            final double d = Math.hypot(entry.getValue()[0] - center[0], entry.getValue()[1] - center[1]);
            f += fireWeight(entry.getKey(), profiles) / (1.0 + d / FIRE_DISTANCE_NORM_M);
        }
        return f;
    }

    private static double fireWeight(final long accountId, final Map<Long, TankTacticalProfile> profiles) {
        final TankTacticalProfile profile = profiles.get(accountId);
        final String cls = profile == null ? "" : profile.vehicleClass();
        double w = switch (cls) {
            case "HEAVY", "TANK_DESTROYER" -> 2.0;
            case "MEDIUM" -> 1.5;
            case "LIGHT" -> 1.0;
            default -> 1.0;
        };
        if (profile != null) {
            if ("HIGH".equals(profile.burstPotential())) {
                w += 0.5;
            }
            if ("HIGH".equals(profile.sustainedDpm())) {
                w += 0.5;
            }
        }
        return w;
    }

    private static double[] regionCenter(final int region) {
        final float third = MapCoordinateProfile.MAP_SIZE / 3f;
        final int row = (region - 1) / 3;
        final int col = (region - 1) % 3;
        return new double[]{(col + 0.5) * third, MapCoordinateProfile.MAP_SIZE - (row + 0.5) * third};
    }





    private static String phaseHeader(final String key, final double start, final double end) {
        return "phase=" + key + " [" + FormationDepthMath.fmt(start) + "-"
                + FormationDepthMath.fmt(end) + "s]\n";
    }
}
